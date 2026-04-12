import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { pipelineDb } from './db';
import {
  PIPELINE_STEPS,
  StepName,
  StartPipelineRequest,
  ProgressFileData,
} from './pipeline-types';
import { resolveProjectPaths } from './project-paths';

// 项目根目录（web/ 的上一级）
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');
const PROGRESS_DIR = path.join(SRC_DIR, '.progress');

// 活跃子进程追踪（单用户系统，内存即可）
const activeProcesses = new Map<string, ChildProcess>();

// 自动重试定时器追踪
const activeRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

export interface RunHandle {
  runId: string;
}

/**
 * 读取 Python 写入的进度 JSON 文件。
 * 返回原始 JSON 字符串（供 SSE 直接转发）和解析后的对象。
 */
export function readProgressFile(runId: string): { raw: string; data: ProgressFileData } | null {
  const filePath = path.join(PROGRESS_DIR, `progress_${runId}.json`);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as ProgressFileData;
    return { raw, data };
  } catch {
    return null;
  }
}

/**
 * 启动一次 pipeline 运行。
 * 立即返回 runId，后台顺序执行各 step。
 */
export function startPipelineRun(request: StartPipelineRequest): RunHandle {
  const runId = randomUUID();
  const { steps, project, config } = request;

  // 将 project 存入 config JSON（Phase 1 不新增 DB 列）
  const configWithProject = { ...config, project: project ?? null };

  // 创建 DB 记录
  pipelineDb.insertRun(runId, configWithProject, steps);
  for (const stepName of steps) {
    pipelineDb.insertStepRun(runId, stepName);
  }

  // 解析项目目录路径
  const projectDir = resolveProjectPaths(project).projectDir;

  // 后台顺序执行（不阻塞 API 响应）
  executeStepsSequentially(runId, steps, config, projectDir).catch((err) => {
    pipelineDb.updateRun(runId, {
      status: 'failed',
      error: err.message,
      completedAt: new Date().toISOString(),
    });
  });

  return { runId };
}

async function executeStepsSequentially(
  runId: string,
  steps: StepName[],
  config: StartPipelineRequest['config'],
  projectDir: string,
  resumeOnly: boolean = false,
): Promise<void> {
  if (!resumeOnly) {
    pipelineDb.updateRun(runId, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });
  }

  for (const stepName of steps) {
    // 检查是否已取消
    const run = pipelineDb.getRun(runId);
    if (run?.status === 'cancelled') return;

    pipelineDb.updateRun(runId, { status: 'running', currentStep: stepName });
    pipelineDb.updateStepRun(runId, stepName, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    try {
      const exitCode = await executeStep(runId, stepName, config, projectDir);

      if (exitCode === 1 && stepName === 'generate_retrieval_queries') {
        // ── 部分失败：step 标 completed + warning，run 暂停等待重试 ──
        const progressData = readProgressFile(runId);
        const failedCount = progressData?.data?.partial_failed ?? 0;
        const warningMsg = failedCount > 0
          ? `${failedCount} 个节点的查询生成未完成`
          : '部分节点的查询生成未完成';

        pipelineDb.updateStepRun(runId, stepName, {
          status: 'completed',
          exitCode: 1,
          warning: warningMsg,
          completedAt: new Date().toISOString(),
        });

        const currentRun = pipelineDb.getRun(runId);
        const currentRetryCount = currentRun?.retry_count ?? 0;

        if (currentRetryCount < 2) {
          const waitMs = currentRetryCount === 0 ? 60_000 : 90_000;
          pipelineDb.updateRun(runId, {
            status: 'waiting_retry',
            retryCount: currentRetryCount + 1,
          });
          scheduleAutoRetry(runId, stepName, steps, config, projectDir, waitMs);
        } else {
          pipelineDb.updateRun(runId, { status: 'waiting_user' });
        }
        return; // 暂停，不继续后续步骤

      } else if (exitCode !== 0) {
        throw new Error(`${stepName} exited with code ${exitCode}`);
      }

      pipelineDb.updateStepRun(runId, stepName, {
        status: 'completed',
        exitCode,
        completedAt: new Date().toISOString(),
      });

      // Step 3（检索）完成后保存快照，供后续差异对比
      if (stepName === 'generate_report_draft') {
        saveRetrievalSnapshot(projectDir);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      pipelineDb.updateStepRun(runId, stepName, {
        status: 'failed',
        error: message,
        completedAt: new Date().toISOString(),
      });
      pipelineDb.updateRun(runId, {
        status: 'failed',
        error: `Failed at ${stepName}: ${message}`,
        completedAt: new Date().toISOString(),
      });
      return; // 第一个失败即停止
    }
  }

  pipelineDb.updateRun(runId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
  });
}

/**
 * 调度自动重试。
 * delayMs 后以 --retry-failed 重跑 generate_retrieval_queries，
 * 成功则继续后续步骤，仍失败则再次暂停或转 waiting_user。
 */
function scheduleAutoRetry(
  runId: string,
  failedStepName: StepName,
  allSteps: StepName[],
  config: StartPipelineRequest['config'],
  projectDir: string,
  delayMs: number,
): void {
  const timer = setTimeout(async () => {
    activeRetryTimers.delete(runId);

    // 确认 run 仍在 waiting_retry（未被取消）
    const run = pipelineDb.getRun(runId);
    if (!run || run.status !== 'waiting_retry') return;

    // 重置 step 为 running
    pipelineDb.updateRun(runId, { status: 'running', currentStep: failedStepName });
    pipelineDb.updateStepRun(runId, failedStepName, {
      status: 'running',
      startedAt: new Date().toISOString(),
      warning: null,
      error: null,
    });

    try {
      const exitCode = await executeStep(
        runId,
        failedStepName,
        { ...config, retryFailed: true },
        projectDir,
      );

      if (exitCode === 1) {
        // 补跑后仍有失败
        const progressData = readProgressFile(runId);
        const failedCount = progressData?.data?.partial_failed ?? 0;
        const retryCount = run.retry_count ?? 1;
        const warningMsg = failedCount > 0
          ? `${failedCount} 个节点的查询生成未完成`
          : '部分节点的查询生成未完成';

        pipelineDb.updateStepRun(runId, failedStepName, {
          status: 'completed',
          exitCode: 1,
          warning: warningMsg,
          completedAt: new Date().toISOString(),
        });

        if (retryCount < 2) {
          pipelineDb.updateRun(runId, {
            status: 'waiting_retry',
            retryCount: retryCount + 1,
          });
          scheduleAutoRetry(runId, failedStepName, allSteps, config, projectDir, 90_000);
        } else {
          // 两次自动重试均失败，等待用户操作
          pipelineDb.updateRun(runId, { status: 'waiting_user' });
        }

      } else if (exitCode === 0) {
        // 补跑全部成功，继续后续步骤
        pipelineDb.updateStepRun(runId, failedStepName, {
          status: 'completed',
          exitCode: 0,
          warning: null,
          completedAt: new Date().toISOString(),
        });
        const remainingSteps = allSteps.slice(allSteps.indexOf(failedStepName) + 1);
        await executeStepsSequentially(runId, remainingSteps, config, projectDir, true);

      } else {
        throw new Error(`${failedStepName} exited with code ${exitCode}`);
      }

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      pipelineDb.updateStepRun(runId, failedStepName, {
        status: 'failed',
        error: message,
        completedAt: new Date().toISOString(),
      });
      pipelineDb.updateRun(runId, {
        status: 'failed',
        error: `Failed at ${failedStepName}: ${message}`,
        completedAt: new Date().toISOString(),
      });
    }
  }, delayMs);

  activeRetryTimers.set(runId, timer);
}

/**
 * 用户主动跳过失败节点，继续后续步骤。
 * 仅在 run.status === 'waiting_user' 时有效。
 */
export function skipFailedAndContinue(runId: string): boolean {
  const run = pipelineDb.getRun(runId);
  if (!run || run.status !== 'waiting_user') return false;

  // 清理待定定时器
  const timer = activeRetryTimers.get(runId);
  if (timer) { clearTimeout(timer); activeRetryTimers.delete(runId); }

  const allSteps = JSON.parse(run.steps) as StepName[];
  const stepsArr = pipelineDb.getStepRuns(runId);
  const waitingStep = stepsArr.find(
    s => s.step_name === 'generate_retrieval_queries' && s.exit_code === 1
  );
  if (!waitingStep) return false;

  const remainingSteps = allSteps.slice(allSteps.indexOf(waitingStep.step_name as StepName) + 1);
  const configParsed = JSON.parse(run.config) as StartPipelineRequest['config'] & { project?: string };
  const projectDir = resolveProjectPaths(configParsed.project).projectDir;

  // step 标 skipped（warning 保留，供前端展示"已跳过 X 条"）
  pipelineDb.updateStepRun(runId, waitingStep.step_name, {
    status: 'skipped',
  });

  executeStepsSequentially(runId, remainingSteps, configParsed, projectDir, true).catch((err) => {
    pipelineDb.updateRun(runId, {
      status: 'failed',
      error: err.message,
      completedAt: new Date().toISOString(),
    });
  });

  return true;
}

function executeStep(
  runId: string,
  stepName: StepName,
  config: StartPipelineRequest['config'],
  projectDir: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    const stepDef = PIPELINE_STEPS.find((s) => s.name === stepName);
    if (!stepDef) return reject(new Error(`Unknown step: ${stepName}`));

    const scriptPath = path.join(SRC_DIR, stepDef.script);
    const scriptArgs = buildArgs(stepName, runId, config, projectDir);
    const condaEnv = stepDef.conda;

    // 使用 conda run 启动，与 CLAUDE.md 中的命令一致
    const child = spawn('conda', ['run', '-n', condaEnv, 'python3', scriptPath, ...scriptArgs], {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // 追踪 PID
    const processKey = `${runId}:${stepName}`;
    activeProcesses.set(processKey, child);
    pipelineDb.updateStepRun(runId, stepName, { pid: child.pid ?? null });

    // 收集 stdout/stderr 用于调试
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 32768) stdout = stdout.slice(-32768);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 32768) stderr = stderr.slice(-32768);
    });

    child.on('close', (code) => {
      activeProcesses.delete(processKey);
      if (code === null) {
        // 进程被杀（取消）
        reject(new Error('Process was terminated'));
      } else {
        if (code !== 0 && !(code === 1 && stepName === 'generate_retrieval_queries')) {
          // 非预期的失败：把 stderr 最后 20 行作为错误信息
          const lastLines = stderr.trim().split('\n').slice(-20).join('\n');
          console.error(`[Pipeline] ${stepName} exited with code ${code}\n--- stderr ---\n${lastLines}\n--- end ---`);
          pipelineDb.updateStepRun(runId, stepName, { error: lastLines || `exit code ${code}` });
        }
        resolve(code);
      }
    });

    child.on('error', (err) => {
      activeProcesses.delete(processKey);
      reject(err);
    });
  });
}

function buildArgs(
  stepName: StepName,
  runId: string,
  config: StartPipelineRequest['config'],
  projectDir: string
): string[] {
  const args = ['--tracker', runId];

  // 传入项目目录
  args.push('--project-dir', projectDir);

  switch (stepName) {
    case 'align_evidence':
      if (config.rebuild) args.push('--rebuild', config.rebuild);
      break;
    case 'generate_draft':
      if (config.resume) args.push('--resume');
      if (config.limit) args.push('--limit', String(config.limit));
      if (config.debug) args.push('--debug');
      break;
    case 'generate_retrieval_queries':
      if (config.debug) args.push('--debug');
      if (config.retryFailed) args.push('--retry-failed');
      break;
    // generate_report_draft 无额外参数
  }

  return args;
}

/**
 * 取消活跃的 pipeline 运行。
 */
export function cancelPipelineRun(runId: string): boolean {
  const run = pipelineDb.getRun(runId);
  if (!run || !['running', 'waiting_retry', 'waiting_user'].includes(run.status)) return false;

  const now = new Date().toISOString();

  // 清理自动重试定时器
  const timer = activeRetryTimers.get(runId);
  if (timer) { clearTimeout(timer); activeRetryTimers.delete(runId); }

  pipelineDb.updateRun(runId, {
    status: 'cancelled',
    completedAt: now,
  });

  // 把所有 running/pending 的 step 标记为 cancelled/skipped
  const steps = pipelineDb.getStepRuns(runId);
  for (const step of steps) {
    if (step.status === 'running') {
      pipelineDb.updateStepRun(runId, step.step_name, {
        status: 'cancelled',
        completedAt: now,
      });
    } else if (step.status === 'pending') {
      pipelineDb.updateStepRun(runId, step.step_name, {
        status: 'skipped',
      });
    }
  }

  // 杀掉活跃子进程
  for (const [key, child] of Array.from(activeProcesses.entries())) {
    if (key.startsWith(runId)) {
      child.kill('SIGTERM');
      // 5 秒后强制杀
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5000);
    }
  }

  return true;
}

/**
 * 保存检索结果快照，供 Step 3 重跑后做差异对比。
 * 把当前 retrieval_results.json 复制为 retrieval_results_prev.json。
 */
function saveRetrievalSnapshot(projectDir: string): void {
  const reportDraftDir = path.join(projectDir, 'processed', 'report_draft');
  const src = path.join(reportDraftDir, 'retrieval_results.json');
  const dst = path.join(reportDraftDir, 'retrieval_results_prev.json');
  try {
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    }
  } catch {
    // 快照保存失败不影响主流程
  }
}

/**
 * 清理超过 24 小时的进度文件。
 */
export function cleanupProgressFiles(): void {
  if (!fs.existsSync(PROGRESS_DIR)) return;
  const now = Date.now();
  for (const file of fs.readdirSync(PROGRESS_DIR)) {
    const filePath = path.join(PROGRESS_DIR, file);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > 24 * 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // ignore
    }
  }
}

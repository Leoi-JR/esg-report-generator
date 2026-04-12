/**
 * python-bridge.ts
 *
 * Node.js 端调用 Python 脚本的封装工具。
 * 使用 child_process.spawn，捕获 stdout JSON 输出。
 */
import { spawn } from 'child_process';
import path from 'path';

/** 项目根目录（web/ 的上一级） */
const PROJECT_ROOT = path.resolve(process.cwd(), '..');

interface PythonJsonResult {
  success: boolean;
  zip_path?: string;
  error?: string;
}

/**
 * 执行 Python 脚本，解析 stdout 的 JSON 输出。
 *
 * @param scriptPath - 相对项目根的脚本路径，如 "src/generate_folder_structure.py"
 * @param args - CLI 参数列表
 * @param timeout - 超时毫秒数（默认 120 秒）
 */
export function runPythonScript(
  scriptPath: string,
  args: string[],
  timeout = 120_000
): Promise<PythonJsonResult> {
  return new Promise((resolve, reject) => {
    const fullScript = path.resolve(PROJECT_ROOT, scriptPath);
    const proc = spawn('conda', ['run', '-n', 'esg', 'python3', fullScript, ...args], {
      cwd: PROJECT_ROOT,
      timeout,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python exited with code ${code}: ${stderr || stdout}`));
        return;
      }
      // stdout 可能包含 Python print 输出 + JSON，取最后一行 JSON
      const lines = stdout.trim().split('\n');
      const lastLine = lines[lines.length - 1];
      try {
        resolve(JSON.parse(lastLine));
      } catch {
        reject(new Error(`Failed to parse Python JSON output: ${lastLine}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn Python: ${err.message}`));
    });
  });
}

/**
 * 调用 generate_folder_structure.py 生成目录结构 ZIP。
 *
 * @returns ZIP 文件的绝对路径
 */
export async function generateFolderStructureZip(
  companyName: string,
  referenceExcel: string,
  outputDir: string
): Promise<string> {
  const result = await runPythonScript(
    'src/generate_folder_structure.py',
    [
      '--company-name', companyName,
      '--reference-excel', referenceExcel,
      '--output-dir', outputDir,
    ],
    120_000
  );

  if (!result.success || !result.zip_path) {
    throw new Error(result.error ?? 'Unknown error generating ZIP');
  }

  return result.zip_path;
}

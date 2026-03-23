import Link from 'next/link';
import { FileText, ArrowRight, BarChart3, Users, Calendar } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center gap-3">
            <FileText className="text-blue-600" size={28} />
            <h1 className="text-xl font-semibold text-gray-900">ESG 报告编辑平台</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">项目列表</h2>

        {/* Project Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
          <div className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  艾森股份 2025 ESG 报告
                </h3>
                <p className="text-gray-600 text-sm mb-4">
                  江苏艾森半导体材料股份有限公司 2025 年度环境、社会及公司治理报告
                </p>

                {/* Stats */}
                <div className="flex items-center gap-6 text-sm text-gray-500">
                  <div className="flex items-center gap-2">
                    <BarChart3 size={16} />
                    <span>119 个章节</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar size={16} />
                    <span>创建于 2026-03-21</span>
                  </div>
                </div>
              </div>

              <Link
                href="/editor"
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <span>进入编辑</span>
                <ArrowRight size={16} />
              </Link>
            </div>

            {/* Progress Bar */}
            <div className="mt-6">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-gray-600">完成进度</span>
                <span className="font-medium text-gray-900">71%</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full" style={{ width: '71%' }} />
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  85 已生成
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-gray-300 rounded-full"></span>
                  34 已跳过
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                  0 已审核
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

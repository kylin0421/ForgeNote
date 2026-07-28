import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  BrainCircuit,
  Check,
  ChevronRight,
  CirclePlay,
  Code2,
  FileText,
  LibraryBig,
  MessageCircleMore,
  Network,
  RefreshCw,
  Route,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Target,
  Video,
  Workflow,
} from "lucide-react";

export const metadata: Metadata = {
  title: {
    absolute: "ForgeNote｜画像驱动的 AI 学习工作台",
  },
  description:
    "先通过自然对话理解学生，再由多智能体协作生成、编排与评估个性化多模态学习资源。",
};

const profileDimensions = [
  "专业与课程",
  "知识基础",
  "学习目标",
  "认知风格",
  "薄弱知识点",
  "易错点偏好",
  "学习节奏",
  "历史反馈",
];

const resourceTypes = [
  { icon: BookOpenText, label: "课程讲解" },
  { icon: FileText, label: "博客文章" },
  { icon: BrainCircuit, label: "思维导图" },
  { icon: Target, label: "练习与测验" },
  { icon: Code2, label: "代码实验" },
  { icon: Video, label: "视频与播客" },
];

const workflowSteps = [
  { label: "画像", detail: "理解学生" },
  { label: "规划", detail: "拆解目标" },
  { label: "检索", detail: "核验资料" },
  { label: "生成", detail: "制作资产" },
  { label: "评估", detail: "更新策略" },
  { label: "安全", detail: "内容把关" },
];

function ProductShot({
  src,
  alt,
  label,
  className = "",
  priority = false,
}: {
  src: string;
  alt: string;
  label: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <figure className={`group relative ${className}`}>
      <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-blue-500/10 blur-3xl transition group-hover:bg-blue-500/15" />
      <div className="overflow-hidden rounded-[1.35rem] border border-slate-200/90 bg-white shadow-[0_28px_80px_-30px_rgba(15,23,42,0.35)]">
        <div className="flex h-9 items-center gap-1.5 border-b border-slate-200/80 bg-slate-50/90 px-4">
          <span className="size-2 rounded-full bg-[#ff7b72]" />
          <span className="size-2 rounded-full bg-[#f2cc60]" />
          <span className="size-2 rounded-full bg-[#56d364]" />
          <span className="ml-2 text-[10px] font-medium tracking-[0.16em] text-slate-400">
            REAL PRODUCT
          </span>
        </div>
        <div className="relative aspect-video overflow-hidden bg-slate-950">
          <Image
            src={src}
            alt={alt}
            fill
            priority={priority}
            className="object-cover object-top transition duration-700 group-hover:scale-[1.015]"
            sizes="(max-width: 768px) 100vw, 1200px"
          />
        </div>
      </div>
      <figcaption className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-500">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        {label}
      </figcaption>
    </figure>
  );
}

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f6f8fc] text-slate-950 selection:bg-blue-200">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-200/70 bg-[#f6f8fc]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link
            href="/"
            className="flex items-center gap-2.5"
            aria-label="ForgeNote 首页"
          >
            <Image src="/logo.svg" alt="" width={34} height={34} />
            <span className="text-lg font-semibold tracking-[-0.03em]">
              ForgeNote
            </span>
          </Link>

          <nav
            className="hidden items-center gap-7 text-sm text-slate-600 md:flex"
            aria-label="首页导航"
          >
            <a className="transition hover:text-slate-950" href="#features">
              核心能力
            </a>
            <a className="transition hover:text-slate-950" href="#workflow">
              协作流程
            </a>
            <a className="transition hover:text-slate-950" href="#trust">
              评估与安全
            </a>
          </nav>

          <Link
            href="/notebooks"
            className="group inline-flex h-10 items-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-medium text-white shadow-lg shadow-slate-950/10 transition hover:-translate-y-0.5 hover:bg-blue-700"
          >
            开始使用
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </header>

      <section className="relative px-5 pb-24 pt-32 sm:px-8 sm:pt-40 lg:px-12 lg:pb-32">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 -z-0 h-[760px] opacity-70"
          style={{
            background:
              "radial-gradient(circle at 18% 18%, rgba(96,165,250,.22), transparent 30%), radial-gradient(circle at 82% 14%, rgba(45,212,191,.17), transparent 28%), linear-gradient(180deg, #f8fbff 0%, rgba(246,248,252,0) 82%)",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 -z-0 h-[760px] opacity-[0.28]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(100,116,139,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(100,116,139,.12) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "linear-gradient(to bottom, black, transparent 78%)",
          }}
        />

        <div className="relative mx-auto max-w-[1440px]">
          <div className="mx-auto max-w-5xl text-center">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-blue-200/80 bg-white/80 px-4 py-2 text-xs font-semibold tracking-[0.12em] text-blue-700 shadow-sm shadow-blue-900/5 backdrop-blur">
              <Sparkles className="size-3.5" />
              对话驱动 · 画像先行 · 多智能体协作
            </div>
            <h1 className="text-balance text-[clamp(3.25rem,7.8vw,7.6rem)] font-semibold leading-[0.92] tracking-[-0.065em] text-slate-950">
              不是把资料堆给你，
              <span className="mt-3 block bg-gradient-to-r from-blue-700 via-cyan-600 to-emerald-600 bg-clip-text text-transparent">
                而是从真正懂你开始。
              </span>
            </h1>
            <p className="mx-auto mt-8 max-w-3xl text-balance text-base leading-8 text-slate-600 sm:text-lg">
              ForgeNote
              先通过自然对话建立动态学习画像，再让多个智能体协作搜索、生成、编排与评估学习资源，让每次学习反馈都成为下一步更精准的依据。
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/notebooks"
                className="group inline-flex h-13 w-full items-center justify-center gap-2 rounded-full bg-blue-700 px-7 text-sm font-semibold text-white shadow-[0_16px_36px_-12px_rgba(29,78,216,.65)] transition hover:-translate-y-0.5 hover:bg-blue-800 sm:w-auto"
              >
                开始使用 ForgeNote
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/workflow"
                className="inline-flex h-13 w-full items-center justify-center gap-2 rounded-full border border-slate-300 bg-white/80 px-7 text-sm font-semibold text-slate-800 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-slate-400 hover:bg-white sm:w-auto"
              >
                <Workflow className="size-4 text-blue-700" />
                查看多智能体监督台
              </Link>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-slate-500">
              {["无需繁琐表单", "画像随学随新", "生成过程全程可追踪"].map(
                (item) => (
                  <span key={item} className="inline-flex items-center gap-1.5">
                    <Check className="size-3.5 text-emerald-600" />
                    {item}
                  </span>
                ),
              )}
            </div>
          </div>

          <div className="relative mx-auto mt-16 max-w-[1320px] sm:mt-20">
            <div
              aria-hidden="true"
              className="absolute -inset-x-24 inset-y-12 -z-10 rounded-full bg-blue-400/20 blur-[90px]"
            />
            <ProductShot
              src="/landing/learning-workspace.png"
              alt="ForgeNote 学习工作台真实界面，包含来源、学习对话和学习资产区域"
              label="真实产品界面 · 个性化学习工作台"
              priority
            />
            <div className="absolute -left-2 top-12 hidden rounded-2xl border border-white/80 bg-white/90 p-4 shadow-xl shadow-slate-900/10 backdrop-blur xl:block">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                  <RefreshCw className="size-5" />
                </span>
                <div>
                  <p className="text-xs text-slate-500">学习画像</p>
                  <p className="mt-0.5 text-sm font-semibold">刚刚自动更新</p>
                </div>
              </div>
            </div>
            <div className="absolute -right-2 bottom-20 hidden rounded-2xl border border-white/80 bg-slate-950/92 p-4 text-white shadow-xl shadow-slate-900/20 backdrop-blur xl:block">
              <div className="flex items-center gap-3">
                <span className="relative flex size-3">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-cyan-400 opacity-70" />
                  <span className="relative inline-flex size-3 rounded-full bg-cyan-400" />
                </span>
                <div>
                  <p className="text-xs text-slate-400">资源智能体</p>
                  <p className="mt-0.5 text-sm font-semibold">正在生成课程讲解</p>
                </div>
              </div>
            </div>
          </div>

          <dl className="mx-auto mt-14 grid max-w-4xl grid-cols-3 divide-x divide-slate-200 text-center">
            {[
              ["8", "动态画像维度"],
              ["10+", "学习资产类型"],
              ["9", "协作智能体"],
            ].map(([value, label]) => (
              <div key={label} className="px-3">
                <dt className="text-3xl font-semibold tracking-[-0.05em] sm:text-4xl">
                  {value}
                </dt>
                <dd className="mt-1.5 text-xs text-slate-500 sm:text-sm">
                  {label}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section
        id="features"
        className="scroll-mt-20 border-y border-slate-200/80 bg-white px-5 py-24 sm:px-8 lg:px-12 lg:py-32"
      >
        <div className="mx-auto max-w-[1320px]">
          <div className="grid items-start gap-12 lg:grid-cols-[0.82fr_1.18fr] lg:gap-20">
            <div className="lg:sticky lg:top-28">
              <div className="mb-5 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
                <BrainCircuit className="size-4" />
                Profile first
              </div>
              <h2 className="text-balance text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-5xl">
                学习画像不是设置项，
                <span className="block text-slate-400">而是整个系统的起点。</span>
              </h2>
              <p className="mt-6 max-w-xl text-base leading-8 text-slate-600">
                第一次进入时，导师会围绕专业、目标、当前水平、学习历史和偏好展开细致对话。画像会在新对话、测验完成和学习反馈后持续更新，并始终支持查看与手动修改。
              </p>
              <div className="mt-8 grid grid-cols-2 gap-2.5">
                {profileDimensions.map((dimension, index) => (
                  <div
                    key={dimension}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700"
                  >
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700">
                      {index + 1}
                    </span>
                    {dimension}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-5">
              <article className="overflow-hidden rounded-[1.75rem] bg-slate-950 p-6 text-white sm:p-8">
                <div className="flex items-start justify-between gap-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-400">
                      自然对话建档
                    </p>
                    <h3 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
                      不填表，聊着聊着就更懂你
                    </h3>
                  </div>
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/10 text-cyan-300">
                    <MessageCircleMore className="size-5" />
                  </span>
                </div>
                <div className="mt-8 space-y-3">
                  <div className="mr-8 rounded-2xl rounded-tl-md bg-white/8 p-4 text-sm leading-6 text-slate-200">
                    你希望这门课最终帮助你完成什么？之前在哪些知识点上最容易卡住？
                  </div>
                  <div className="ml-12 rounded-2xl rounded-tr-md bg-blue-600 p-4 text-sm leading-6">
                    我想两周后能独立完成课程项目，但正则化和偏差-方差还是容易混淆。
                  </div>
                </div>
                <div className="mt-5 flex items-center justify-between rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3">
                  <span className="flex items-center gap-2 text-sm text-emerald-200">
                    <Sparkles className="size-4" />
                    已抽取 3 个新特征
                  </span>
                  <span className="text-xs text-emerald-300/70">
                    画像版本 v4
                  </span>
                </div>
              </article>

              <div className="grid gap-5 sm:grid-cols-2">
                <article className="rounded-[1.75rem] border border-slate-200 bg-[#f7f9ff] p-6 sm:p-7">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-blue-100 text-blue-700">
                      <Target className="size-5" />
                    </span>
                    <h3 className="font-semibold">测验后更新</h3>
                  </div>
                  <p className="mt-5 text-sm leading-7 text-slate-600">
                    题目表现会转化为掌握度、易错点和信心变化，立即影响下一步路径与资源推荐。
                  </p>
                  <div className="mt-6 h-2 overflow-hidden rounded-full bg-blue-100">
                    <div className="h-full w-[72%] rounded-full bg-gradient-to-r from-blue-600 to-cyan-500" />
                  </div>
                  <div className="mt-2 flex justify-between text-[11px] text-slate-500">
                    <span>正则化掌握度</span>
                    <span>72%</span>
                  </div>
                </article>

                <article className="rounded-[1.75rem] border border-slate-200 bg-[#f5fbf8] p-6 sm:p-7">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                      <Route className="size-5" />
                    </span>
                    <h3 className="font-semibold">路径随学随新</h3>
                  </div>
                  <p className="mt-5 text-sm leading-7 text-slate-600">
                    完成、跳过、提问和资源反馈都会重新计算学习顺序，让计划始终贴合真实进度。
                  </p>
                  <div className="mt-6 flex items-center gap-2 text-xs font-medium text-emerald-700">
                    <span className="size-2 rounded-full bg-emerald-500" />
                    下一步已重新规划
                  </div>
                </article>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-slate-950 px-5 py-24 text-white sm:px-8 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1320px]">
          <div className="grid gap-12 lg:grid-cols-[1fr_0.8fr] lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400">
                Learning assets
              </p>
              <h2 className="mt-5 max-w-3xl text-balance text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-5xl">
                想学什么，就把最合适的内容放到你面前。
              </h2>
            </div>
            <p className="max-w-xl text-base leading-8 text-slate-400 lg:justify-self-end">
              资料始终占据学习界面的主体。系统会检索带来源与标签的视频、文章和网页，也能由不同角色的智能体协作生成十余种个性化学习资产。
            </p>
          </div>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {resourceTypes.map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.055] p-5 transition hover:-translate-y-0.5 hover:border-cyan-400/30 hover:bg-white/[0.08]"
              >
                <span className="grid size-11 place-items-center rounded-xl bg-white/10 text-cyan-300">
                  <Icon className="size-5" />
                </span>
                <span className="font-medium">{label}</span>
                <ChevronRight className="ml-auto size-4 text-slate-500" />
              </div>
            ))}
          </div>

          <div className="mt-16 grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
            <ProductShot
              src="/landing/learning-library.png"
              alt="ForgeNote 学习资料库真实界面"
              label="真实产品界面 · 学习资料库"
            />
            <ProductShot
              src="/landing/source-search.png"
              alt="ForgeNote 提问与资源搜索智能体真实界面"
              label="真实产品界面 · 有来源的资料检索"
            />
          </div>

          <div className="mt-16 grid gap-6 lg:grid-cols-2">
            <article className="rounded-[1.75rem] border border-white/10 bg-white/[0.055] p-7 sm:p-9">
              <div className="flex items-center gap-3 text-cyan-300">
                <MessageCircleMore className="size-5" />
                <span className="text-xs font-semibold uppercase tracking-[0.16em]">
                  对话即入口
                </span>
              </div>
              <blockquote className="mt-7 text-xl font-medium leading-9 tracking-[-0.02em] sm:text-2xl">
                “这个我还是听不懂，能不能给我来一篇博客讲解，再配几道例题？”
              </blockquote>
              <div className="mt-8 rounded-2xl border border-blue-400/20 bg-blue-500/10 p-4">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-xl bg-blue-500 text-white">
                    <Sparkles className="size-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">已调用博客与练习生成</p>
                    <p className="mt-1 text-xs text-slate-400">
                      自动读取当前画像与学习进度
                    </p>
                  </div>
                </div>
              </div>
            </article>

            <article className="rounded-[1.75rem] border border-white/10 bg-gradient-to-br from-blue-600/25 to-emerald-500/10 p-7 sm:p-9">
              <div className="flex items-center gap-3 text-emerald-300">
                <LibraryBig className="size-5" />
                <span className="text-xs font-semibold uppercase tracking-[0.16em]">
                  一处管理
                </span>
              </div>
              <h3 className="mt-7 text-2xl font-semibold tracking-[-0.03em]">
                按钮能生成，对话也能生成
              </h3>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                无论从 Studio 点击创建，还是在辅导对话中自然提出需求，最终都会沉淀为可查看、复用和继续迭代的学习资产。
              </p>
              <div className="mt-8 flex flex-wrap gap-2">
                {["画像上下文", "来源标签", "生成进度", "版本记录"].map(
                  (item) => (
                    <span
                      key={item}
                      className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs text-slate-200"
                    >
                      {item}
                    </span>
                  ),
                )}
              </div>
            </article>
          </div>
        </div>
      </section>

      <section
        id="workflow"
        className="scroll-mt-20 bg-white px-5 py-24 sm:px-8 lg:px-12 lg:py-32"
      >
        <div className="mx-auto max-w-[1320px]">
          <div className="mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
              <Network className="size-4" />
              Multi-agent workflow
            </div>
            <h2 className="mt-5 text-balance text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-5xl">
              一个学习目标，多个专业角色接棒完成。
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-slate-600">
              独立监督台会实时显示当前步骤、负责智能体、输入输出与异常状态。生成不是黑盒，等待也不再是白屏。
            </p>
          </div>

          <div className="relative mt-16">
            <div
              aria-hidden="true"
              className="absolute left-[8%] right-[8%] top-8 hidden h-px bg-gradient-to-r from-blue-200 via-cyan-400 to-emerald-300 lg:block"
            />
            <div className="relative grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              {workflowSteps.map((step, index) => (
                <div
                  key={step.label}
                  className="rounded-2xl border border-slate-200 bg-[#f8fafc] p-5 text-center"
                >
                  <span className="relative mx-auto grid size-16 place-items-center rounded-full border-4 border-white bg-slate-950 text-sm font-semibold text-white shadow-lg shadow-slate-900/10">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p className="mt-4 font-semibold">{step.label}</p>
                  <p className="mt-1 text-xs text-slate-500">{step.detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-10 flex justify-center">
            <Link
              href="/workflow"
              className="group inline-flex h-12 items-center gap-2 rounded-full border border-slate-300 bg-white px-6 text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:text-blue-700"
            >
              打开实时监督台
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>

      <section
        id="trust"
        className="scroll-mt-20 border-y border-slate-200 bg-[#eef4ff] px-5 py-24 sm:px-8 lg:px-12 lg:py-32"
      >
        <div className="mx-auto grid max-w-[1320px] gap-14 lg:grid-cols-[0.88fr_1.12fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
              Evaluate · verify · adapt
            </p>
            <h2 className="mt-5 text-balance text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-5xl">
              不只生成内容，
              <span className="block text-slate-400">还要证明学习真的发生。</span>
            </h2>
            <div className="mt-8 space-y-4">
              {[
                {
                  icon: Target,
                  title: "学习效果评估也是一种资产",
                  copy: "随时结合当前画像、练习表现和资源反馈生成多维评估，并给出下一轮行动建议。",
                },
                {
                  icon: SearchCheck,
                  title: "来源支撑与事实核验",
                  copy: "检索结果保留视频、文章、网页链接与标签，生成内容经过来源约束和事实检查。",
                },
                {
                  icon: ShieldCheck,
                  title: "安全过滤贯穿全流程",
                  copy: "从输入防注入到输出内容审查，风险会被标记、拦截并留下可追踪的处理结果。",
                },
              ].map(({ icon: Icon, title, copy }) => (
                <article
                  key={title}
                  className="flex gap-4 rounded-2xl border border-blue-100 bg-white/80 p-5 shadow-sm shadow-blue-900/5"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-blue-100 text-blue-700">
                    <Icon className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {copy}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <ProductShot
            src="/landing/video-asset.png"
            alt="ForgeNote 多模态讲解视频资产真实界面"
            label="真实产品界面 · 多模态讲解资产"
          />
        </div>
      </section>

      <section className="px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="relative mx-auto max-w-[1320px] overflow-hidden rounded-[2rem] bg-slate-950 px-6 py-16 text-center text-white sm:px-12 lg:py-20">
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 18% 50%, rgba(37,99,235,.45), transparent 32%), radial-gradient(circle at 82% 20%, rgba(13,148,136,.32), transparent 30%)",
            }}
          />
          <div className="relative mx-auto max-w-3xl">
            <span className="mx-auto grid size-13 place-items-center rounded-2xl border border-white/10 bg-white/10 text-cyan-300">
              <CirclePlay className="size-6" />
            </span>
            <h2 className="mt-7 text-balance text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
              从一门真正想学会的课开始。
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-slate-300 sm:text-base">
              告诉 ForgeNote 你的目标与现状，先建立画像，再开启一条会随着你不断进化的学习路径。
            </p>
            <Link
              href="/notebooks"
              className="group mt-9 inline-flex h-13 items-center gap-2 rounded-full bg-white px-7 text-sm font-semibold text-slate-950 shadow-xl transition hover:-translate-y-0.5 hover:bg-cyan-50"
            >
              开始使用
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 px-5 py-8 sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-[1320px] flex-col items-center justify-between gap-4 text-xs text-slate-500 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.svg" alt="" width={26} height={26} />
            <span className="font-semibold text-slate-700">ForgeNote</span>
            <span>画像驱动的 AI 学习工作台</span>
          </div>
          <div className="flex items-center gap-5">
            <a href="#features" className="transition hover:text-slate-950">
              核心能力
            </a>
            <Link href="/workflow" className="transition hover:text-slate-950">
              工作流监督
            </Link>
            <Link href="/notebooks" className="transition hover:text-slate-950">
              进入产品
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

export const AI_LEARNING_DEMO_TOTAL_STEPS = 14

export type AiLearningDemoScene = 'notebook' | 'search' | 'workflow' | 'studio'

export const AI_LEARNING_DEMO_STEPS = [
  { step: 0, scene: 'notebook', label: '新学习记录', href: '/notebooks/ai-learning-demo' },
  { step: 1, scene: 'notebook', label: '画像访谈', href: '/notebooks/ai-learning-demo?step=1' },
  { step: 2, scene: 'notebook', label: '建立画像', href: '/notebooks/ai-learning-demo?step=2' },
  { step: 3, scene: 'notebook', label: '提出问题', href: '/notebooks/ai-learning-demo?step=3' },
  { step: 4, scene: 'notebook', label: '个性化回答', href: '/notebooks/ai-learning-demo?step=4' },
  { step: 5, scene: 'search', label: '拆解检索意图', href: '/search/ai-learning-demo?step=5' },
  { step: 6, scene: 'search', label: '并行深度检索', href: '/search/ai-learning-demo?step=6' },
  { step: 7, scene: 'search', label: '证据综合', href: '/search/ai-learning-demo?step=7' },
  { step: 8, scene: 'workflow', label: 'Agent 调度', href: '/workflow/ai-learning-demo?step=8' },
  { step: 9, scene: 'workflow', label: '多智能体协作', href: '/workflow/ai-learning-demo?step=9' },
  { step: 10, scene: 'workflow', label: '工作流完成', href: '/workflow/ai-learning-demo?step=10' },
  { step: 11, scene: 'studio', label: '生成多模态资产', href: '/notebooks/ai-learning-demo/studio?step=11' },
  { step: 12, scene: 'studio', label: '多模态成品', href: '/notebooks/ai-learning-demo/studio?step=12' },
  { step: 13, scene: 'studio', label: 'Quiz 评估', href: '/notebooks/ai-learning-demo/studio?step=13' },
  { step: 14, scene: 'studio', label: '画像回写', href: '/notebooks/ai-learning-demo/studio?step=14' },
] as const satisfies ReadonlyArray<{
  step: number
  scene: AiLearningDemoScene
  label: string
  href: string
}>

export function demoStepHref(step: number) {
  const safeStep = Math.max(0, Math.min(AI_LEARNING_DEMO_TOTAL_STEPS, step))
  return AI_LEARNING_DEMO_STEPS[safeStep].href
}

export function defaultDemoStepForPath(pathname: string | null) {
  if (pathname?.startsWith('/search/')) return 5
  if (pathname?.startsWith('/workflow/')) return 8
  if (pathname?.includes('/studio')) return 11
  return 0
}

export const AI_LEARNING_DEMO = {
  notebookName: 'ai学习',
  topic: '理解 Transformer 的 Q、K、V 与注意力机制',
  profileQuestion:
    '开始前想先了解一下：你目前对注意力机制掌握到什么程度，更喜欢怎样的讲解方式？',
  profileAnswer:
    '我会 Python，也学过基础神经网络。知道注意力会给信息分配权重，但还不清楚 Q、K、V 为什么这样设计。我更喜欢图解、类比和能运行的代码。',
  profileDimensions: [
    { label: '知识基础', value: '机器学习入门', score: 72 },
    { label: '认知偏好', value: '图解与类比', score: 88 },
    { label: '学习目标', value: '理解并实现', score: 81 },
    { label: '学习节奏', value: '短路径实践', score: 84 },
    { label: '动机水平', value: '项目驱动', score: 79 },
    { label: '反馈偏好', value: '即时纠错', score: 86 },
    { label: '当前瓶颈', value: '张量关系', score: 64 },
    { label: '迁移能力', value: '需要示例', score: 68 },
  ],
  userQuestion:
    '能不能用一个直观例子解释 Q、K、V，再告诉我它们如何一起算出注意力？',
  assistantAnswer:
    '可以把它想成一次“带着问题查索引”：Q 是你此刻想找什么，K 是每条信息的索引标签，V 是信息本身。Q 与所有 K 比较得到相关度，再用这些权重混合 V。接下来我会用权威资料、动态图解和一段 PyTorch 代码把这条链路验证完整。',
  searchQuery: 'Transformer Q K V 注意力机制 图解 PyTorch 实现',
  searchIntents: [
    {
      agent: 'Scholar Agent',
      intent: '追溯原始公式与设计依据',
      scope: '论文 / 引用网络',
      result: '定位缩放点积注意力原始定义',
    },
    {
      agent: 'Web Agent',
      intent: '寻找适合图解型学习者的解释',
      scope: '教程 / 课程 / 动画',
      result: '筛选出 2 个高质量可视化教程',
    },
    {
      agent: 'Code Agent',
      intent: '验证张量形状与可运行实现',
      scope: '官方文档 / 代码仓库',
      result: '确认 PyTorch MultiheadAttention 接口',
    },
  ],
  sources: [
    {
      title: 'Attention Is All You Need',
      kind: '论文',
      meta: '论文 · Vaswani et al. · 2017',
      domain: 'arXiv',
      score: 98,
      insight: '给出 scaled dot-product attention 与 multi-head attention 的原始定义。',
      recommendation: '原始定义，作为公式与事实基线',
    },
    {
      title: 'The Illustrated Transformer',
      kind: '图解',
      meta: '图解教程 · Jay Alammar',
      domain: 'jalammar.github.io',
      score: 96,
      insight: '用逐帧可视化串起 Q、K、V、softmax 与信息聚合。',
      recommendation: '高度匹配“图解 + 类比”的认知偏好',
    },
    {
      title: 'MultiheadAttention — PyTorch',
      kind: '代码',
      meta: '官方文档 · PyTorch 2.x',
      domain: 'pytorch.org',
      score: 94,
      insight: '提供张量形状、参数说明和可运行实现接口。',
      recommendation: '对应“理解并实现”的学习目标',
    },
    {
      title: 'Attention for Neural Networks, Clearly Explained',
      kind: '视频',
      meta: '讲解视频 · StatQuest · 18:24',
      domain: 'youtube.com',
      score: 92,
      insight: '用动画和逐步推导解释 Query、Key、Value 的信息流。',
      recommendation: '适合在播客前进行一次视听预习',
    },
  ],
  evidenceSummary:
    '4 个独立来源在“Q 与 K 计算相关性、softmax 归一化、再对 V 加权求和”这一核心链路上相互印证；原论文负责定义，官方文档验证实现，图解教程匹配当前画像。',
  workflowAgents: [
    { name: '学习画像智能体', role: '读取 8 维画像与当前知识缺口', duration: '0.8 秒' },
    { name: '课程结构智能体', role: '拆解 QKV 的先修关系与学习顺序', duration: '1.2 秒' },
    { name: '资源搜集智能体', role: '并行检索论文、教程、文档与代码', duration: '3.8 秒' },
    { name: '安全校验智能体', role: '执行权威性、交叉一致性与画像适配三道质量门', duration: '1.6 秒' },
    { name: '资源生成智能体', role: '生成指南、导图、播客和 Quiz', duration: '4.3 秒' },
    { name: '学习评估智能体', role: '评估掌握度并回写学习画像', duration: '0.9 秒' },
  ],
  assets: [
    {
      type: '学习指南',
      title: 'QKV：从检索类比到矩阵运算',
      meta: '8 分钟阅读 · 4 个引用',
      description: '类比 → 公式 → 张量形状 → PyTorch 实现',
    },
    {
      type: '思维导图',
      title: '注意力机制知识地图',
      meta: '12 个节点 · 3 层关系',
      description: '把 Q、K、V、相似度、softmax 与输出串成一张图',
    },
    {
      type: '学习播客',
      title: '为什么注意力需要 Q、K、V？',
      meta: '06:42 · 双人讲解 · 已生成字幕',
      description: '用图书馆检索类比串讲注意力计算流程',
    },
    {
      type: 'Quiz',
      title: 'QKV 概念诊断',
      meta: '5 题 · 难度自适应',
      description: '检验相关性计算、权重归一化与 Value 聚合',
    },
    {
      type: '辅助图片',
      title: 'QKV 信息流一图读懂',
      meta: '1600 × 900 · 可导出',
      description: '用颜色区分查询、匹配、归一化与信息聚合',
    },
    {
      type: '讲解视频',
      title: '3 分钟走完一次注意力计算',
      meta: '03:18 · 1080p · 已生成字幕',
      description: '动态图解 QKᵀ、softmax 与 Value 加权',
    },
  ],
  guideSections: [
    'Q 是当前 token 发出的检索请求',
    'K 描述每个 token 能被怎样匹配',
    'softmax 将 QKᵀ 转成注意力权重',
    '权重与 V 相乘，得到按需聚合的上下文',
  ],
  mindMapBranches: [
    { label: 'Query', detail: '我想找什么' },
    { label: 'Key', detail: '我能匹配什么' },
    { label: 'Value', detail: '我携带的信息' },
    { label: 'Attention', detail: '相关性 → 权重 → 聚合' },
  ],
  podcast: {
    title: '为什么注意力需要 Q、K、V？',
    duration: '06:42',
    currentTime: '02:18',
    transcript:
      '把 Query 想成读者手里的问题，Key 是书架索引，而 Value 才是书中真正要取出的内容。',
  },
  quiz: {
    question: '当某个 Query 与一个 Key 的相似度更高时，后续最可能发生什么？',
    options: [
      '对应 Value 在输出中的占比提高',
      '对应 Value 会被直接删除',
      'Query 的维度会自动增加',
      '所有 Key 的权重都会变成零',
    ],
    answer: '对应 Value 在输出中的占比提高',
    explanation:
      'QKᵀ 的相似度经过 softmax 后成为权重；相似度越高，对应 Value 在加权和中的贡献通常越大。',
  },
  profileUpdate: {
    dimension: '概念理解',
    before: 72,
    after: 80,
    evidence: '完成 QKV Quiz，正确解释注意力权重如何影响 Value 聚合。',
    next: '进入 Multi-Head Attention：理解不同注意力头如何学习互补关系。',
  },
} as const

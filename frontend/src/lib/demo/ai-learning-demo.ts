export const AI_LEARNING_DEMO_TOTAL_STEPS = 9

export const AI_LEARNING_DEMO = {
  notebookName: 'ai学习',
  topic: '如何理解 Transformer 的注意力机制',
  profileQuestion:
    '先从你熟悉的概念开始：你目前如何理解“注意力”在模型中的作用？',
  profileAnswer:
    '我会 Python，也学过基础神经网络。知道注意力会给信息分配权重，但还不清楚 Q、K、V 为什么这样设计。',
  profileDimensions: [
    { label: '知识基础', value: '机器学习入门', score: 72 },
    { label: '理解方式', value: '图解 + 类比', score: 86 },
    { label: '目标深度', value: '能解释并实现', score: 78 },
    { label: '学习节奏', value: '短路径实践', score: 83 },
  ],
  userQuestion:
    '能不能用一个直观例子解释 Q、K、V，再告诉我它们如何一起算出注意力？',
  assistantAnswer:
    '可以把它想成一次“带着问题查索引”：Q 是你此刻想找什么，K 是每条信息的索引标签，V 是信息本身。Q 与所有 K 比较得到相关度，再用这些权重混合 V。这样，同一句话里的每个词都能按当前需要动态收集上下文。',
  orchestration: [
    '识别知识缺口：Q / K / V 的协作关系',
    '匹配学习偏好：优先图解与可运行示例',
    '检索权威资料，并将难度控制在入门到进阶之间',
  ],
  sources: [
    {
      title: 'Attention Is All You Need',
      meta: '论文 · Vaswani et al.',
      insight: '自注意力与缩放点积注意力的原始定义',
      accent: 'from-blue-500/20 to-cyan-500/5',
    },
    {
      title: 'The Illustrated Transformer',
      meta: '图解教程 · Jay Alammar',
      insight: '用可视化流程串起编码、注意力与信息聚合',
      accent: 'from-violet-500/20 to-fuchsia-500/5',
    },
    {
      title: 'PyTorch MultiheadAttention',
      meta: '官方文档 · PyTorch',
      insight: '从公式落到可运行实现与张量形状',
      accent: 'from-orange-500/20 to-amber-500/5',
    },
  ],
  generationTask: {
    title: '正在生成：QKV 交互式学习卡',
    detail: '综合画像、当前对话与 3 个来源，自动采用“类比 → 图解 → 代码”的讲解路径。',
  },
  studioAsset: {
    title: 'QKV：从检索类比到代码实现',
    type: '交互式学习卡',
    duration: '8 分钟',
    sections: ['生活类比', '矩阵图解', 'PyTorch 实现'],
  },
  quiz: {
    question: '当某个 Query 与一个 Key 的相似度更高时，会发生什么？',
    options: [
      '对应 Value 在输出中的占比提高',
      '对应 Value 会被直接删除',
      'Query 的维度会自动增加',
    ],
    answer: '对应 Value 在输出中的占比提高',
    feedback: '掌握度 +8%，画像已更新：概念理解 72% → 80%',
  },
} as const

export const AI_LEARNING_DEMO_STEP_LABELS = [
  '崭新的学习记录',
  '画像访谈',
  '画像完成',
  '提出问题',
  '个性化回答',
  'Agent 调度',
  '资料就绪',
  '生成学习资产',
  'Studio 资产完成',
  'Quiz 与画像回写',
] as const

/** 用户反馈 */

/** 反馈类型：功能建议 / 问题反馈 / 其他 */
export type FeedbackType = 'suggestion' | 'bug' | 'other';

/** 反馈状态：待处理 / 处理中 / 已解决 / 已关闭 */
export type FeedbackStatus = 'pending' | 'processing' | 'resolved' | 'closed';

/** 反馈回复（管理员回复或用户追加） */
export interface FeedbackReply {
  id: string;
  feedbackId: string;
  userId: string;
  userName: string;
  content: string;
  /** 是否管理员回复 */
  isAdmin: boolean;
  createdAt: string;
}

export interface Feedback {
  id: string;
  tenantId: string;
  userId: string;
  userName: string;
  /** 反馈类型 */
  type: FeedbackType;
  /** 反馈内容 */
  content: string;
  /** 关联的功能/页面（可选） */
  source?: string;
  /** 状态 */
  status: FeedbackStatus;
  /** 回复列表 */
  replies: FeedbackReply[];
  createdAt: string;
  updatedAt?: string;
}

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  suggestion: '功能建议',
  bug: '问题反馈',
  other: '其他',
};

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  pending: '待处理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};

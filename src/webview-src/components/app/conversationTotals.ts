export type ConversationTotals = {
  contextTokens: number;
  totalTokens: number;
  totalCost: number;
  costIsKnown: boolean;
};

export const INITIAL_CONVERSATION_TOTALS: ConversationTotals = {
  contextTokens: 0,
  totalTokens: 0,
  totalCost: 0,
  costIsKnown: false,
};


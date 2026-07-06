export const INTENT_KINDS = [
  'greeting',
  'find_projects',
  'get_price',
  'get_project_info',
  'book_visit',
  'confirm_action',
  'express_objection',
  'get_legal_info',
  'acknowledge',
  'other',
] as const;

export type IntentKind = (typeof INTENT_KINDS)[number];

import type { TranslationShape } from '../../shape';
import type zh from '../zh-Hant/report';

export default {
  category_HARASSMENT: 'Harassment',
  category_HATE_SPEECH: 'Hate speech',
  category_CHEATING: 'Cheating',
  category_SPAM: 'Spam',
  category_INAPPROPRIATE_NAME: 'Inappropriate name',
  category_INAPPROPRIATE_CONTENT: 'Inappropriate content',
  category_OTHER: 'Other',
} satisfies TranslationShape<typeof zh>;

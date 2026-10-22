export type IssueSeverity = 'error' | 'warning' | 'info';

export type IssueCode =
  | 'FILE_TOO_LARGE'
  | 'FILE_EMPTY'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'INVALID_ENCODING'
  | 'AMBIGUOUS_DELIMITER'
  | 'CSV_PARSE_ERROR'
  | 'TOO_MANY_ROWS'
  | 'MISSING_REQUIRED_COLUMN'
  | 'DUPLICATE_COLUMN_MAPPING'
  | 'AMBIGUOUS_COLUMN_IGNORED'
  | 'UNKNOWN_COLUMN_IGNORED'
  | 'REQUIRED_VALUE_MISSING'
  | 'INVALID_FORMAT'
  | 'INVALID_DATE'
  | 'AMBIGUOUS_DATE_FORMAT'
  | 'INVALID_NUMBER'
  | 'NEGATIVE_VALUE'
  | 'TOO_MANY_DECIMALS'
  | 'UNSUPPORTED_BILLING_TYPE'
  | 'MISSING_CANCELLATION_REFERENCE'
  | 'DUPLICATE_ROW_IN_FILE'
  | 'CONFLICTING_DUPLICATE_KEY'
  | 'CONFLICTS_WITH_EXISTING'
  | 'INVALID_CONTROL_TOTALS'
  | 'CLASSIFICATION_MISMATCH';

export interface ImportIssue {
  severity: IssueSeverity;
  code: IssueCode;
  message: string;
  /** 1-based line number in the source file (header is line 1). */
  line?: number;
  field?: string;
}

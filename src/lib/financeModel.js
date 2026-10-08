// The calculator models an interest rate, not lender APR or TILA disclosures.
// Keep internal `apr` keys stable for existing device drafts and domain APIs.
export const FINANCE_RATE_LABEL = 'Annual interest rate';
export const FINANCE_BALANCE_LABEL = 'Estimated loan balance';
export const FINANCE_MODEL_EXPLANATION = 'Payments use the assumed annual interest rate with equal monthly periods. Lender APR, credit-specific fees, payment dates and final payment may differ. The estimated loan balance is not a lender disclosure of amount financed. Confirm lender disclosures separately.';

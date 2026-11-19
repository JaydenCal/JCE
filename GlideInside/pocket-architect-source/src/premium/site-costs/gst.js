// GST on the indicative site cost estimate. The estimate is GST excluded; GST is 10 percent in Australia. Indicative only, not a tax invoice or a quote.

export const GST_RATE = 0.1;
export const GST_NOTE = 'Site costs are shown GST excluded. GST at 10 percent is added in the included figure. Indicative only: not a quote and not a tax invoice.';
export const gstOf = (exAmount) => {
  const ex = Math.round(Number(exAmount) || 0);
  const gst = Math.round(ex * GST_RATE);
  return { ex, gst, incl: ex + gst };
};

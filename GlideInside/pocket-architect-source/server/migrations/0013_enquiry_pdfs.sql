-- 13. "Send plans to a registered engineer": keep the PDF plan set with the saved enquiry so the owner can download it
-- from the admin route even before email is set up. Chunked (D1 rows are limited to about 2 MB). Additive only.
CREATE TABLE IF NOT EXISTS jce_enquiry_pdfs (
  reference TEXT NOT NULL,
  seq INTEGER NOT NULL,
  chunk TEXT NOT NULL,              -- base64 text, up to 500000 characters
  PRIMARY KEY (reference, seq)
);

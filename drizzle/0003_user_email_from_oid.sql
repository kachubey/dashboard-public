-- The internal e-mail is now derived from the immutable object ID instead of
-- the UPN, so a reused UPN can't block a new employee's sign-in.
UPDATE "user" SET "email" = lower("oid") || '@oid.invalid' WHERE "email" <> lower("oid") || '@oid.invalid';

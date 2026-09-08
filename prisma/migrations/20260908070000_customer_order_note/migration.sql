-- Customer delivery note, on both the live checkout and the order it becomes.
--
-- Additive and nullable, which is what makes it safe to apply BEFORE the code that uses it
-- ships: the currently deployed build simply never selects these columns. Apply first, deploy
-- second, and there is no window in which either half is broken.
--
-- Deliberately not reusing "giftMessage". That column is retired from the UI but kept for
-- gift wrapping (see ShippingMethodStep), and a shopper's delivery instruction landing in a
-- field the admin reads as a gift card would be worse than a new column.

ALTER TABLE "checkouts" ADD COLUMN "customerNote" TEXT;
ALTER TABLE "orders" ADD COLUMN "customerNote" TEXT;

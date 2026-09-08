/**
 * How long a delivery note may be.
 *
 * 300 characters, matching the retired gift message, and chosen for the reader rather than the
 * database: the note is read by whoever packs the box, on a screen beside the address, and is a
 * candidate for the courier's own instruction field once ACS is live. Those fields are finite.
 * A note long enough to be skimmed and abandoned is worse than one that has to be concise.
 */
export const CUSTOMER_NOTE_MAX_LENGTH = 300;

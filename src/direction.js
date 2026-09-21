const RTL = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
const LTR = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]/u;

/** Returns the direction of the first strong character, defaulting to LTR. */
export function directionForText(text) {
  for (const character of text) {
    if (RTL.test(character)) return "rtl";
    if (LTR.test(character)) return "ltr";
  }
  return "ltr";
}

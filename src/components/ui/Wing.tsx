/**
 * 과천시 상징(날개). 색은 `currentColor` 를 따라간다 — 쓰는 자리에서 정한다.
 * 장식이므로 `aria-hidden`. 이름은 옆 글자가 말한다.
 */
export default function Wing({ size = 22 }: { size?: number }) {
  return (
    <svg className="wing" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12.2c0-5.6-3.4-8.9-6.6-8-3.1.9-3.6 5.6-.2 7.9-3.4 2.3-2.9 7 .2 7.9 3.2.9 6.6-2.4 6.6-7.8zm0 0c0-5.6 3.4-8.9 6.6-8 3.1.9 3.6 5.6.2 7.9 3.4 2.3 2.9 7-.2 7.9-3.2.9-6.6-2.4-6.6-7.8z" />
    </svg>
  );
}

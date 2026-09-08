/**
 * 앱 마크.
 *
 * 특정 기관의 상징을 쓰지 않는다 — 이 콘솔은 어느 기관에나 붙는다. 뜻은 "기한 안에 닫힌 일"
 * 하나다. 색은 `currentColor` 를 따라가고, 장식이라 `aria-hidden` 이다. 이름은 옆 글자가 말한다.
 */
export default function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg
      className="mark-i"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.3l2.7 2.7L16 9.6" />
    </svg>
  );
}

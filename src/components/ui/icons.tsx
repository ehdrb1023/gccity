/** 화면에서 쓰는 선 아이콘. 전부 24 그리드, `currentColor`, 장식이라 aria-hidden. */

type P = { size?: number };
const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const Search = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);

export const Chevron = ({ size = 16 }: P) => (
  <svg {...base(size)} className="chev">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const Arrow = ({ size = 18 }: P) => (
  <svg {...base(size)} style={{ flex: 'none' }}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const Spark = ({ size = 15 }: P) => (
  <svg {...base(size)}>
    <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
  </svg>
);

export const Check = ({ size = 15 }: P) => (
  <svg {...base(size)} strokeWidth={2.4}>
    <path d="M4 12.5l5 5L20 6.5" />
  </svg>
);

export const Doc = ({ size = 20 }: P) => (
  <svg {...base(size)}>
    <path d="M5 4h14v16H5z" />
    <path d="M8 9h8M8 13h5" />
  </svg>
);

export const Inbox = ({ size = 20 }: P) => (
  <svg {...base(size)}>
    <path d="M4 13h4l2 3h4l2-3h4" />
    <path d="M4 13l2-7h12l2 7v5H4z" />
  </svg>
);

export const Chat = ({ size = 20 }: P) => (
  <svg {...base(size)}>
    <path d="M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
  </svg>
);

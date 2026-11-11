import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
  'aria-hidden': true
}

export function LogoIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={16} height={16} {...props} strokeWidth={1.8}>
      <path d="M13 2 5 13.5h5.5L10 22l8-11.5h-5.5L13 2Z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function PowerIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={24} height={24} {...props}>
      <path d="M12 3v8" />
      <path d="M6.3 6.8a8 8 0 1 0 11.4 0" />
    </svg>
  )
}

export function HomeIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={18} height={18} {...props}>
      <path d="m3.5 10.5 8.5-7 8.5 7" />
      <path d="M5.5 9v10.5h13V9" />
      <path d="M9.5 19.5v-6h5v6" />
    </svg>
  )
}

export function GlobeIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={18} height={18} {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.3 2.4 3.5 5.3 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.3-3.5-8.5S9.7 5.9 12 3.5Z" />
    </svg>
  )
}

export function RouteIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={18} height={18} {...props}>
      <circle cx="5.5" cy="6" r="2.5" />
      <circle cx="18.5" cy="18" r="2.5" />
      <path d="M8 6h4.5a3.5 3.5 0 0 1 0 7h-1a3.5 3.5 0 0 0 0 7H16" />
    </svg>
  )
}

export function ChartIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={18} height={18} {...props}>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="m7.5 15 3.5-4 3 2.5 4.5-6" />
    </svg>
  )
}

export function GearIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={18} height={18} {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 14a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V20a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 18.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 14a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 7.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V2a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03Z" />
    </svg>
  )
}

export function SearchIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={16} height={16} {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  )
}

export function ArrowDownIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={16} height={16} {...props}>
      <path d="M12 4v15" />
      <path d="m6 13 6 6 6-6" />
    </svg>
  )
}

export function ArrowUpIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={16} height={16} {...props}>
      <path d="M12 20V5" />
      <path d="m6 11 6-6 6 6" />
    </svg>
  )
}

export function SignalIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={16} height={16} {...props}>
      <path d="M5 18.5v-3" />
      <path d="M9.7 18.5v-6" />
      <path d="M14.3 18.5v-9" />
      <path d="M19 18.5v-12" />
    </svg>
  )
}

export function ShieldIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={16} height={16} {...props}>
      <path d="M12 3 5 6v6c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

export function LockIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={16} height={16} {...props}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7" />
    </svg>
  )
}

export function CheckIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={12} height={12} {...props} strokeWidth={2.4}>
      <path d="m4 12.5 5.5 5.5L20 6" />
    </svg>
  )
}

export function ChevronIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={12} height={12} {...props}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

export function ExpandIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={14} height={14} {...props}>
      <path d="M14 4h6v6" />
      <path d="m20 4-8 8" />
      <path d="M10 20H4v-6" />
      <path d="m4 20 8-8" />
    </svg>
  )
}

export function ShrinkIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={14} height={14} {...props}>
      <path d="M10 4v6H4" />
      <path d="m10 10-6 6" />
      <path d="M14 20v-6h6" />
      <path d="m14 14 6-6" />
    </svg>
  )
}

export function ServerIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={16} height={16} {...props}>
      <rect x="3.5" y="4" width="17" height="6" rx="1.8" />
      <rect x="3.5" y="14" width="17" height="6" rx="1.8" />
      <path d="M7 7h.01M7 17h.01" />
    </svg>
  )
}

export function WifiIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={16} height={16} {...props}>
      <path d="M2.5 8.5a14 14 0 0 1 19 0" />
      <path d="M5.6 12a9.5 9.5 0 0 1 12.8 0" />
      <path d="M8.8 15.4a5 5 0 0 1 6.4 0" />
      <path d="M12 19h.01" />
    </svg>
  )
}

export function SparkIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={16} height={16} {...props}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  )
}

export function StarIcon({ filled = false, ...props }: IconProps & { filled?: boolean }): React.JSX.Element {
  return (
    <svg {...base} width={15} height={15} {...props}>
      <path
        d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9L12 3.6Z"
        fill={filled ? 'currentColor' : 'none'}
      />
    </svg>
  )
}

export function BoltIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={15} height={15} {...props}>
      <path d="M13 2 5 13.5h5.5L10 22l8-11.5h-5.5L13 2Z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function CopyIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={14} height={14} {...props}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M5.5 15.5h-1a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

export function ClipboardIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={14} height={14} {...props}>
      <rect x="6" y="4.5" width="12" height="16" rx="2" />
      <path d="M9 4.5V3.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 3.5v1" />
      <path d="M9.5 10h5M9.5 14h5" />
    </svg>
  )
}

export function HistoryIcon(props: IconProps): React.JSX.Element {
  return (
    <svg {...base} width={16} height={16} {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3.5 4.5V9H8" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  )
}

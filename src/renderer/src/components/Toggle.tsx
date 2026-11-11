interface ToggleProps {
  checked: boolean
  onChange: (value: boolean) => void
  label?: string
}

export function Toggle({ checked, onChange, label }: ToggleProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

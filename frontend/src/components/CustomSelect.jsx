import { useState, useRef, useEffect } from 'react'

export function CustomSelect({ options, value, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const selected = options.find((o) => o.value === value)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className={`cselect${open ? ' cselect--open' : ''}${disabled ? ' cselect--disabled' : ''}`} ref={ref}>
      <button
        type="button"
        className="cselect__trigger"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
      >
        <span>{selected?.label ?? ''}</span>
        <svg className="cselect__arrow" width="10" height="6" viewBox="0 0 10 6" fill="none">
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul className="cselect__menu">
          {options.map((o) => (
            <li
              key={o.value}
              className={`cselect__item${o.value === value ? ' cselect__item--active' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false) }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

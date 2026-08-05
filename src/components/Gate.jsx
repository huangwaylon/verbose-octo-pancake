import { useState } from 'react'
import { PERSON } from '../schema.js'
import { nameOf } from '../lib/identity.js'
import { WalletIcon } from './icons.jsx'

/** Full-screen screens shown before the app has what it needs to run. */
function Panel({ title, children }) {
  return (
    <div className="gate">
      <div className="gate__panel card">
        <WalletIcon className="gate__icon" width={32} height={32} />
        <h1 className="gate__title">{title}</h1>
        {children}
      </div>
    </div>
  )
}

export function UnconfiguredGate() {
  return (
    <Panel title="Not configured yet">
      <p className="gate__text">
        This build is missing <code>VITE_GOOGLE_CLIENT_ID</code> or{' '}
        <code>VITE_GOOGLE_API_KEY</code>. Both are public values, set at build time.
      </p>
      <p className="gate__text">
        Follow <code>SETUP.md</code> to create them, then put them in <code>.env</code> for local
        development or in the repository variables for GitHub Pages.
      </p>
    </Panel>
  )
}

export function SignInGate({ onSignIn, status, error }) {
  return (
    <Panel title="Shared Finances">
      <p className="gate__text">
        Groceries and food, split between two people. Everything lives in your own Google Sheet.
      </p>
      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={onSignIn}
        disabled={status === 'signing-in'}
      >
        {status === 'signing-in' ? <span className="spinner" /> : null}
        Sign in with Google
      </button>
      {error && <p className="field__error">{error}</p>}
      <p className="gate__fine">
        The app asks only for access to the single spreadsheet you pick — not your whole Drive.
      </p>
    </Panel>
  )
}

export function SheetGate({ onCreate, onChoose, error }) {
  const [busy, setBusy] = useState(null)

  async function run(kind, action) {
    setBusy(kind)
    try {
      await action()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel title="Pick a sheet">
      <p className="gate__text">
        Start a fresh spreadsheet, or connect one you already have. You can change this later.
      </p>
      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={() => run('create', () => onCreate('Shared Finances'))}
        disabled={Boolean(busy)}
      >
        {busy === 'create' ? <span className="spinner" /> : null}
        Create a new sheet
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--block"
        onClick={() => run('choose', onChoose)}
        disabled={Boolean(busy)}
      >
        {busy === 'choose' ? <span className="spinner" /> : null}
        Choose an existing sheet
      </button>
      {error && <p className="field__error">{error}</p>}
    </Panel>
  )
}

export function IdentityGate({ config, onPick }) {
  return (
    <Panel title="Which one are you?">
      <p className="gate__text">
        So the app can say &ldquo;you&rdquo; instead of a name. Stored on this device only.
      </p>
      {[PERSON.P1, PERSON.P2].map((person) => (
        <button
          key={person}
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => onPick(person)}
        >
          {nameOf(config, person)}
        </button>
      ))}
      <p className="gate__fine">
        Set both names in the <code>config</code> tab of your sheet if these look wrong.
      </p>
    </Panel>
  )
}

export function LoadingGate({ label = 'Loading' }) {
  return (
    <div className="gate" aria-busy="true">
      <span className="spinner spinner--lg" />
      <span className="visually-hidden">{label}</span>
    </div>
  )
}

export function ErrorGate({ message, onRetry, onSwitchSheet }) {
  return (
    <Panel title="Could not read the sheet">
      <p className="gate__text">{message}</p>
      <button type="button" className="btn btn--primary btn--block" onClick={onRetry}>
        Try again
      </button>
      <button type="button" className="btn btn--ghost btn--block" onClick={onSwitchSheet}>
        Pick a different sheet
      </button>
    </Panel>
  )
}

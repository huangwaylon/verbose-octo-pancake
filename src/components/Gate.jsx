import { useState } from 'react'
import { CONFIG_TAB, PEOPLE } from '../schema.js'
import { usePeopleLabels, useT } from '../i18n/index.js'
import { useTNodes } from '../i18n/nodes.jsx'
import { Field } from './Field.jsx'
import { WalletIcon } from './icons.jsx'

/** Full-screen screens shown before the app has what it needs to run. */
function Panel({ title, children }) {
  return (
    <div className="gate">
      <div className="gate__panel">
        <WalletIcon className="gate__icon" width={28} height={28} />
        <h1 className="gate__title">{title}</h1>
        {children}
      </div>
    </div>
  )
}

export function UnconfiguredGate() {
  const { t } = useT()
  const tn = useTNodes()

  return (
    <Panel title={t('gate.unconfiguredTitle')}>
      <p className="gate__text">
        {tn('gate.unconfiguredBody', { scriptUrl: <code>VITE_SCRIPT_URL</code> })}
      </p>
      <p className="gate__text">
        {tn('gate.unconfiguredFollow', {
          setup: <code>SETUP.md</code>,
          env: <code>.env</code>,
        })}
      </p>
    </Panel>
  )
}

/**
 * Takes the app key once per device.
 *
 * This replaces a Google sign-in button, and the difference is the whole point of
 * the design: a key that works keeps working, so this screen is shown once and
 * then never again — no popup, no consent flow, nothing that expires.
 */
export function KeyGate({ onConnect, connecting, error, suspect }) {
  const { t } = useT()
  const [value, setValue] = useState('')

  return (
    <Panel title={t('app.name')}>
      <p className="gate__text">{t('app.tagline')}</p>
      <form
        className="gate__actions"
        onSubmit={(event) => {
          event.preventDefault()
          onConnect(value)
        }}
      >
        <Field htmlFor="app-key" label={t('gate.keyLabel')}>
          <input
            id="app-key"
            className="input"
            type="password"
            // A password field so iOS offers to store it in the Keychain, which is
            // what makes "typed once per device" true rather than aspirational.
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t('gate.keyPlaceholder')}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <button
          type="submit"
          className="btn btn--primary btn--block"
          disabled={connecting || !value.trim()}
        >
          {connecting ? <span className="spinner" /> : null}
          {t('gate.connect')}
        </button>
      </form>
      {/* A stored key the endpoint has rejected, with no fresher failure to show:
          the key was kept deliberately, so say why this screen came back. */}
      {suspect && !error && <p className="field__error">{t('error.badKey')}</p>}
      {error && <p className="field__error">{error}</p>}
      <p className="field__hint">{t('gate.keyFine')}</p>
    </Panel>
  )
}

export function IdentityGate({ config, onPick }) {
  const { t } = useT()
  const tn = useTNodes()
  // No `me` yet — that is what this gate is asking — so both read as real names.
  const { name } = usePeopleLabels(config, null)

  return (
    <Panel title={t('gate.identityTitle')}>
      <p className="gate__text">{t('gate.identityBody')}</p>
      <div className="gate__actions">
        {PEOPLE.map((person) => (
          <button
            key={person}
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => onPick(person)}
          >
            {name(person)}
          </button>
        ))}
      </div>
      <p className="field__hint">{tn('gate.identityFine', { tab: <code>{CONFIG_TAB}</code> })}</p>
    </Panel>
  )
}

export function LoadingGate({ label }) {
  return (
    <div className="gate" aria-busy="true">
      <span className="spinner spinner--lg" />
      <span className="visually-hidden">{label}</span>
    </div>
  )
}

export function ErrorGate({ message, onRetry }) {
  const { t } = useT()

  return (
    <Panel title={t('gate.errorTitle')}>
      <p className="gate__text">{message}</p>
      <div className="gate__actions">
        <button type="button" className="btn btn--primary btn--block" onClick={onRetry}>
          {t('common.retry')}
        </button>
      </div>
    </Panel>
  )
}

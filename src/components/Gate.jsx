import { useState } from 'react'
import { CONFIG_TAB, PERSON } from '../schema.js'
import { nameOf } from '../lib/identity.js'
import { useT } from '../i18n/index.js'
import { useTNodes } from '../i18n/nodes.jsx'
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
        {tn('gate.unconfiguredBody', {
          clientId: <code>VITE_GOOGLE_CLIENT_ID</code>,
          apiKey: <code>VITE_GOOGLE_API_KEY</code>,
        })}
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

export function SignInGate({ onSignIn, status, error }) {
  const { t } = useT()

  return (
    <Panel title={t('app.name')}>
      <p className="gate__text">{t('app.tagline')}</p>
      <div className="gate__actions">
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={onSignIn}
          disabled={status === 'signing-in'}
        >
          {status === 'signing-in' ? <span className="spinner" /> : null}
          {t('gate.signIn')}
        </button>
      </div>
      {error && <p className="field__error">{error}</p>}
      <p className="gate__fine">{t('gate.signInFine')}</p>
    </Panel>
  )
}

export function SheetGate({ onCreate, onChoose, error }) {
  const { t } = useT()
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
    <Panel title={t('gate.sheetTitle')}>
      <p className="gate__text">{t('gate.sheetBody')}</p>
      <div className="gate__actions">
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => run('create', () => onCreate())}
          disabled={Boolean(busy)}
        >
          {busy === 'create' ? <span className="spinner" /> : null}
          {t('gate.createSheet')}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--block"
          onClick={() => run('choose', onChoose)}
          disabled={Boolean(busy)}
        >
          {busy === 'choose' ? <span className="spinner" /> : null}
          {t('gate.chooseSheet')}
        </button>
      </div>
      {error && <p className="field__error">{error}</p>}
    </Panel>
  )
}

export function IdentityGate({ config, onPick }) {
  const { t } = useT()
  const tn = useTNodes()
  const fallbacks = { p1: t('common.person1'), p2: t('common.person2') }

  return (
    <Panel title={t('gate.identityTitle')}>
      <p className="gate__text">{t('gate.identityBody')}</p>
      <div className="gate__actions">
        {[PERSON.P1, PERSON.P2].map((person) => (
          <button
            key={person}
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => onPick(person)}
          >
            {nameOf(config, person, fallbacks)}
          </button>
        ))}
      </div>
      <p className="gate__fine">{tn('gate.identityFine', { tab: <code>{CONFIG_TAB}</code> })}</p>
    </Panel>
  )
}

export function LoadingGate({ label }) {
  const { t } = useT()
  return (
    <div className="gate" aria-busy="true">
      <span className="spinner spinner--lg" />
      <span className="visually-hidden">{label ?? t('gate.loading')}</span>
    </div>
  )
}

export function ErrorGate({ message, onRetry, onSwitchSheet }) {
  const { t } = useT()

  return (
    <Panel title={t('gate.errorTitle')}>
      <p className="gate__text">{message}</p>
      <div className="gate__actions">
        <button type="button" className="btn btn--primary btn--block" onClick={onRetry}>
          {t('common.retry')}
        </button>
        <button type="button" className="btn btn--ghost btn--block" onClick={onSwitchSheet}>
          {t('gate.pickDifferent')}
        </button>
      </div>
    </Panel>
  )
}

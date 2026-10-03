import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Modal, Select } from '@arco-design/web-react';
import { Home, Inbox, User, SettingTwo, Message, ArrowLeft } from '@icon-park/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DraftContext, Empty, useText } from './common';
import { useStudio } from './useStudio';
import { lifecycle } from './client';
import StudioHome from './Home';
import Project from './Project';
import Assets from './panels/Assets';
import styles from './studio.module.css';
import '@renderer/styles/studio-tokens.css';

export default function Studio() {
  const t = useText();
  const navigate = useNavigate();
  const location = useLocation();
  const parts = location.pathname.split('/').filter(Boolean);
  const page = parts[1] ?? 'home';
  const projectId = page === 'project' ? parts[2] : undefined;
  const [preferenceProject, setPreferenceProject] = useState('');
  const state = useStudio(projectId ?? (page === 'preferences' ? preferenceProject || undefined : undefined));
  const [dirty, setDirty] = useState(false);
  const [about, setAbout] = useState(false);
  const quitPrompt = useRef(false);
  useEffect(() => {
    lifecycle()?.setDirty(dirty);
    return () => lifecycle()?.setDirty(false);
  }, [dirty]);
  useEffect(
    () =>
      lifecycle()?.onQuitRequested(() => {
        if (quitPrompt.current) return;
        quitPrompt.current = true;
        Modal.confirm({
          title: t('leaveTitle'),
          content: t('leaveHint'),
          okText: t('quitWithoutSaving'),
          cancelText: t('cancel'),
          onCancel: () => {
            quitPrompt.current = false;
          },
          onOk: () => {
            quitPrompt.current = false;
            setDirty(false);
            lifecycle()?.confirmQuit();
          },
        });
      }),
    [t]
  );
  const guard = useCallback(
    (action: () => void): void => {
      if (!dirty) {
        action();
        return;
      }
      Modal.confirm({
        title: t('leaveTitle'),
        content: t('leaveHint'),
        okText: t('leave'),
        cancelText: t('cancel'),
        onOk: () => {
          setDirty(false);
          action();
        },
      });
    },
    [dirty, t]
  );
  const context = useMemo(() => ({ setDirty, guard }), [guard]);
  const go = (path: string): void => guard(() => void navigate(path));
  const nav = [
    { id: 'home', icon: <Home size={18} /> },
    { id: 'inbox', icon: <Inbox size={18} /> },
    { id: 'preferences', icon: <User size={18} /> },
  ];
  return (
    <DraftContext.Provider value={context}>
      <div className={styles.shell} data-testid='origin-studio'>
        <div className={styles.dragBar} />
        <aside className={styles.sidebar}>
          <Button className={styles.brand} type='text' onClick={() => go('/studio')}>
            <span className={styles.logo} aria-hidden />
            <span>{t('brand')}</span>
          </Button>
          <nav className={styles.nav}>
            {nav.map((item) => (
              <Button
                key={item.id}
                type='text'
                icon={item.icon}
                className={page === item.id ? styles.navActive : ''}
                onClick={() => go(`/studio/${item.id}`)}
              >
                {t(item.id)}
              </Button>
            ))}
          </nav>
          <div className={styles.sideProjects}>
            <span className={styles.sideLabel}>{t('myProjects')}</span>
            {state.projects
              .filter((p) => !p.archived)
              .slice(0, 8)
              .map((p) => (
                <Button
                  key={p.id}
                  type='text'
                  className={p.id === projectId ? styles.navActive : ''}
                  onClick={() => go(`/studio/project/${p.id}`)}
                >
                  <span className={styles.projectDot} />
                  {p.title}
                </Button>
              ))}
          </div>
          <footer className={styles.sideFooter}>
            <Button type='text' icon={<Message size={17} />} onClick={() => go('/guid')}>
              {t('conversations')}
            </Button>
            <Button type='text' icon={<SettingTwo size={17} />} onClick={() => go('/settings/model')}>
              {t('settings')}
            </Button>
            <Button type='text' onClick={() => setAbout(true)}>
              {t('about')}
            </Button>
            <p>
              <span className={styles.localDot} />
              {t('local')}
            </p>
          </footer>
        </aside>
        <main className={styles.main}>
          <div className={styles.topbar}>
            {page === 'project' ? (
              <Button type='text' size='small' icon={<ArrowLeft size={15} />} onClick={() => go('/studio')}>
                {t('home')}
              </Button>
            ) : (
              <span>{t(page === 'home' ? 'home' : page)}</span>
            )}
            <span className={styles.topbarHint}>{t('local')}</span>
          </div>
          {state.error && (
            <div className={styles.page}>
              <Alert
                type='error'
                content={t('errorGeneric')}
                action={<Button onClick={() => void state.refresh()}>{t('retry')}</Button>}
              />
            </div>
          )}
          {state.loading ? (
            <Empty message={t('loading')} />
          ) : (
            <>
              {page === 'home' && (
                <StudioHome
                  projects={state.projects}
                  refresh={state.refresh}
                  open={(id) => go(`/studio/project/${id}`)}
                />
              )}
              {page === 'project' &&
                (state.project ? (
                  <Project
                    key={projectId}
                    project={state.project}
                    items={state.items}
                    preferences={[
                      ...state.inbox.filter((i) => i.kind === 'preference'),
                      ...state.items.filter((i) => i.kind === 'preference'),
                    ]}
                    refresh={state.refresh}
                    home={() => go('/studio')}
                  />
                ) : (
                  <Empty message={t('sourceMissing')} />
                ))}
              {page === 'inbox' && (
                <div className={styles.page}>
                  <h1>{t('inbox')}</h1>
                  <Assets
                    projectId={null}
                    kinds={['capture']}
                    items={state.inbox}
                    allItems={state.inbox}
                    projects={state.projects}
                    refresh={state.refresh}
                  />
                </div>
              )}
              {page === 'preferences' && (
                <div className={styles.page}>
                  <div className={styles.sectionHead}>
                    <h1>{t('preferences')}</h1>
                    <Select
                      aria-label={t('scope')}
                      value={preferenceProject}
                      onChange={(value) => guard(() => setPreferenceProject(value))}
                      options={[
                        { value: '', label: t('global') },
                        ...state.projects.map((p) => ({ value: p.id, label: p.title })),
                      ]}
                      style={{ width: 220 }}
                    />
                  </div>
                  <Assets
                    key={preferenceProject}
                    projectId={preferenceProject || null}
                    kinds={['preference']}
                    items={preferenceProject ? state.items : state.inbox}
                    allItems={preferenceProject ? state.items : state.inbox}
                    refresh={state.refresh}
                  />
                </div>
              )}
            </>
          )}
        </main>
        <Modal visible={about} title={t('about')} footer={null} onCancel={() => setAbout(false)}>
          <p>{t('aboutText')}</p>
        </Modal>
      </div>
    </DraftContext.Provider>
  );
}

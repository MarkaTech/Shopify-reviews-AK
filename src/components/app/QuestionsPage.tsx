'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  HelpCircle, MessageSquare, Pin, Eye, EyeOff, Trash2, Send,
  Loader2, ShoppingBag, Clock, CheckCircle2, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { apiFetch, errorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Panel, Pill, EmptyState, ActionButton, Skeleton, Tile } from './ui-kit';

/**
 * Merchant-facing Q&A moderation.
 *
 * Shoppers submit questions through the storefront widget (POST /api/storefront/questions);
 * there is no merchant-side "ask a question" action, and deliberately so — a question the
 * store wrote and then answered itself is marketing copy dressed as social proof. This
 * screen only moderates what real shoppers sent.
 */

const PAGE_SIZE = 20;

interface Answer {
  id: string;
  questionId: string;
  authorName: string;
  /** merchant | customer — shoppers weigh an official answer differently. */
  authorType: string;
  body: string;
  isPublished: boolean;
  helpfulCount: number;
  createdAt: string;
  updatedAt: string;
}

interface Question {
  id: string;
  storeId: string;
  productId: string | null;
  askerName: string;
  askerEmail: string | null;
  body: string;
  isPublished: boolean;
  isPinned: boolean;
  helpfulCount: number;
  notifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  answers: Answer[];
  product: { id: string; title: string; image: string | null } | null;
}

/**
 * PUT /api/questions/[id] returns the question with its answers but without the product
 * relation, so responses are merged into the existing row rather than replacing it.
 */
type QuestionUpdate = Omit<Question, 'product'>;

/** Tab value → the `status` the GET understands. Empty string means no filter. */
const TABS = [
  { id: 'all', label: 'All', status: '' },
  { id: 'pending', label: 'Pending', status: 'pending' },
  { id: 'unanswered', label: 'Unanswered', status: 'unanswered' },
  { id: 'published', label: 'Published', status: 'published' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const EMPTY_COPY: Record<TabId, { title: string; desc: string }> = {
  all: {
    title: 'No questions yet',
    desc: 'Shoppers ask questions from the Q&A widget on your product pages. Once you answer and publish one, it appears there for every future visitor — which is the point: the same question gets asked over and over, and a published answer stops it becoming an email.',
  },
  pending: {
    title: 'Nothing waiting on you',
    desc: 'Every question has been published. New ones arrive here unpublished, so nothing reaches your storefront until you have read it.',
  },
  unanswered: {
    title: 'Every question has an answer',
    desc: 'A published question with no answer just advertises the silence, so this list is the one worth keeping empty.',
  },
  published: {
    title: 'Nothing published yet',
    desc: 'Published questions and their answers show on the storefront widget. Answer a pending question to put it live.',
  },
};

export default function QuestionsPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<TabId>('all');
  const [loading, setLoading] = useState(true);
  const [composingFor, setComposingFor] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  // Promise chain rather than async/await, and no setLoading(true) at the top.
  //
  // `loading` starts true and every setState here lands in a .then/.catch/.finally
  // callback, so nothing runs synchronously when this is called from an effect — which is
  // what react-hooks/set-state-in-effect exists to catch. Refetching quietly after a
  // filter change also reads better than flashing the skeleton back over the list.
  const load = useCallback(() => {
    const params = new URLSearchParams();
    const status = TABS.find(t => t.id === tab)?.status;
    if (status) params.set('status', status);
    params.set('page', String(page));
    params.set('limit', String(PAGE_SIZE));

    apiFetch<{ questions?: Question[]; total?: number }>(`/api/questions?${params}`)
      .then(data => {
        setQuestions(data.questions || []);
        setTotal(data.total || 0);
      })
      .catch(err => {
        toast.error(errorMessage(err, 'Could not load questions'));
        setQuestions([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [tab, page]);

  useEffect(load, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const selectTab = (id: TabId) => {
    setTab(id);
    setPage(1);
  };

  /**
   * Apply a server response to the list in place.
   *
   * The row is dropped when it no longer matches the active filter — publishing from the
   * Pending tab, for instance — because leaving it visible under a tab it contradicts is
   * how a merchant ends up clicking Publish twice.
   */
  const applyUpdate = (updated: QuestionUpdate) => {
    const stillMatches =
      tab === 'all' ||
      (tab === 'pending' && !updated.isPublished) ||
      (tab === 'published' && updated.isPublished) ||
      (tab === 'unanswered' && updated.answers.length === 0);

    setQuestions(qs =>
      stillMatches
        ? qs.map(q => (q.id === updated.id ? { ...q, ...updated } : q))
        : qs.filter(q => q.id !== updated.id)
    );
    if (!stillMatches) setTotal(t => Math.max(0, t - 1));
  };

  const patch = async (id: string, body: Record<string, unknown>, successMsg: string) => {
    setBusyId(id);
    try {
      const updated = await apiFetch<QuestionUpdate>(`/api/questions/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      toast.success(successMsg);
      applyUpdate(updated);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the question'));
    } finally {
      setBusyId(null);
    }
  };

  const submitAnswer = async (id: string) => {
    const text = (drafts[id] || '').trim();
    if (!text) {
      toast.error('Write an answer before saving.');
      return;
    }
    setBusyId(id);
    try {
      const updated = await apiFetch<QuestionUpdate>(`/api/questions/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ answer: text }),
      });
      // The server publishes the question as part of answering it — one action, not two.
      toast.success('Answer saved. The question is now live on your storefront.');
      setDrafts(d => {
        const next = { ...d };
        delete next[id];
        return next;
      });
      setComposingFor(null);
      applyUpdate(updated);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save the answer'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await apiFetch(`/api/questions/${id}`, { method: 'DELETE' });
      toast.success('Question deleted');
      setQuestions(qs => qs.filter(q => q.id !== id));
      setTotal(t => Math.max(0, t - 1));
      if (composingFor === id) setComposingFor(null);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete the question'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Tabs ── */}
      <Panel className="flex flex-wrap items-center gap-3 p-3">
        <div className="flex rounded-xl bg-ink-100 p-0.5 dark:bg-white/5">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => selectTab(t.id)}
              className={cn(
                'ring-focus rounded-[10px] px-3 py-1.5 text-[12.5px] font-semibold transition-all',
                tab === t.id
                  ? 'bg-card text-ink-900 shadow-[var(--elev-1)] dark:text-white'
                  : 'text-ink-500 hover:text-ink-700 dark:hover:text-ink-200'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[12.5px] text-ink-500">
          {loading ? 'Loading…' : (
            <>
              <span className="tnum font-semibold text-ink-700 dark:text-ink-200">{total}</span>{' '}
              question{total === 1 ? '' : 's'}
            </>
          )}
        </span>
      </Panel>

      {/* ── List ── */}
      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Panel key={i} className="p-4">
              <div className="flex gap-3.5">
                <Skeleton className="size-10 rounded-xl" />
                <div className="flex-1 space-y-2.5">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            </Panel>
          ))
        ) : questions.length === 0 ? (
          <Panel>
            <EmptyState
              icon={HelpCircle}
              tone="violet"
              title={EMPTY_COPY[tab].title}
              description={EMPTY_COPY[tab].desc}
            />
          </Panel>
        ) : (
          questions.map(q => {
            const busy = busyId === q.id;
            const answered = q.answers.length > 0;
            return (
              <Panel
                key={q.id}
                className={cn('relative overflow-hidden transition-opacity', busy && 'opacity-60')}
              >
                {/* Status rail — same language as the review queue. */}
                <span
                  className={cn(
                    'absolute inset-y-0 left-0 w-1',
                    q.isPinned
                      ? 'bg-gradient-to-b from-amber-300 to-amber-500'
                      : !q.isPublished
                        ? 'bg-gradient-to-b from-amber-200 to-amber-400'
                        : 'bg-gradient-to-b from-brand-300 to-brand-500'
                  )}
                />

                <div className="flex gap-3.5 p-4 pl-5">
                  <Tile icon={HelpCircle} tone={answered ? 'brand' : 'violet'} size="lg" />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13.5px] font-semibold text-ink-900 dark:text-white">
                        {q.askerName}
                      </span>
                      {q.isPinned && <Pill tone="amber" icon={Pin}>Pinned</Pill>}
                      <Pill tone={q.isPublished ? 'brand' : 'neutral'} icon={q.isPublished ? CheckCircle2 : Clock}>
                        {q.isPublished ? 'Published' : 'Pending'}
                      </Pill>
                      {!answered && <Pill tone="amber">Unanswered</Pill>}
                      <span className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-ink-400">
                        <Clock className="size-3" />
                        {new Date(q.createdAt).toLocaleDateString(undefined, {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ink-400">
                      <ShoppingBag className="size-3 shrink-0" />
                      <span className="truncate">
                        {q.product ? q.product.title : 'Not linked to a product'}
                      </span>
                    </div>

                    <p className="mt-2.5 text-[13.5px] font-medium leading-relaxed text-ink-800 dark:text-ink-100">
                      {q.body}
                    </p>

                    {answered && (
                      <div className="mt-3 space-y-2">
                        {q.answers.map(a => (
                          <div
                            key={a.id}
                            className="rounded-xl border-l-[3px] border-brand-500 bg-brand-50/60 py-2.5 pl-3 pr-3 dark:bg-brand-500/[0.08]"
                          >
                            <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] font-semibold text-brand-800 dark:text-brand-200">
                              <MessageSquare className="size-3" />
                              {a.authorName}
                              {a.authorType === 'merchant' && <Pill tone="brand">Store</Pill>}
                              <span className="font-normal text-brand-600/70 dark:text-brand-300/60">
                                {new Date(a.createdAt).toLocaleDateString()}
                              </span>
                            </p>
                            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-700 dark:text-ink-200">
                              {a.body}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    {composingFor === q.id ? (
                      <div className="animate-rise mt-3">
                        <Textarea
                          className="min-h-[90px] rounded-xl text-[13px]"
                          placeholder="Answer the question in your own words. This is published to the storefront exactly as written."
                          value={drafts[q.id] || ''}
                          onChange={e => setDrafts(d => ({ ...d, [q.id]: e.target.value }))}
                          maxLength={5000}
                          autoFocus
                        />
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <ActionButton size="sm" disabled={busy} onClick={() => submitAnswer(q.id)}>
                            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                            Save &amp; publish
                          </ActionButton>
                          <ActionButton size="sm" variant="ghost" onClick={() => setComposingFor(null)}>
                            Cancel
                          </ActionButton>
                          <span className="ml-auto text-[11px] text-ink-400">
                            Answering publishes the question — an unanswered question on a product page reads badly.
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3.5 flex flex-wrap items-center gap-1 border-t border-border pt-3">
                        <ActionButton
                          size="sm"
                          variant={answered ? 'outline' : 'primary'}
                          icon={MessageSquare}
                          onClick={() => setComposingFor(q.id)}
                        >
                          {answered ? 'Add another answer' : 'Answer'}
                        </ActionButton>
                        <ActionButton
                          size="sm"
                          variant="ghost"
                          icon={q.isPublished ? EyeOff : Eye}
                          disabled={busy}
                          onClick={() =>
                            patch(
                              q.id,
                              { isPublished: !q.isPublished },
                              q.isPublished ? 'Question unpublished' : 'Question published'
                            )
                          }
                        >
                          {q.isPublished ? 'Unpublish' : 'Publish'}
                        </ActionButton>
                        <ActionButton
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            patch(q.id, { isPinned: !q.isPinned }, q.isPinned ? 'Unpinned' : 'Pinned to the top')
                          }
                        >
                          <Pin className={cn('size-3.5', q.isPinned && 'text-amber-500')} fill={q.isPinned ? 'currentColor' : 'none'} />
                          {q.isPinned ? 'Unpin' : 'Pin'}
                        </ActionButton>
                        <ActionButton
                          size="sm"
                          variant="ghost"
                          icon={Trash2}
                          className="ml-auto text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-500/10"
                          disabled={busy}
                          onClick={() => remove(q.id)}
                        >
                          Delete
                        </ActionButton>
                      </div>
                    )}
                  </div>
                </div>
              </Panel>
            );
          })
        )}
      </div>

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <ActionButton
            size="sm"
            variant="outline"
            icon={ChevronLeft}
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            Previous
          </ActionButton>
          <span className="tnum px-3 text-[12.5px] text-ink-500">Page {page} of {totalPages}</span>
          <ActionButton
            size="sm"
            variant="outline"
            trailingIcon={ChevronRight}
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </ActionButton>
        </div>
      )}
    </div>
  );
}

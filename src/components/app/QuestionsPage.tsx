'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  HelpCircle, MessageSquare, Pin, Eye, EyeOff, Trash2, Send,
  Loader2, ShoppingBag, Clock, CheckCircle2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { apiFetch, errorMessage } from '@/lib/api-client';

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

  // No setLoading(true) at the top. `loading` starts true, and a setState that runs
  // synchronously in an effect body triggers a cascading render — which is what
  // react-hooks/set-state-in-effect flags. Refetching silently after a filter change also
  // reads better than flashing the skeleton back over a list the merchant is looking at.
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
      <div>
        <h2 className="text-lg font-bold">Questions &amp; answers</h2>
        <p className="text-xs text-muted-foreground">
          Questions shoppers asked on your product pages. Answering one publishes it to the storefront Q&amp;A widget.
        </p>
      </div>

      {/* Filters */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-3 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            {TABS.map(t => (
              <Button
                key={t.id}
                variant={tab === t.id ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-[11px] px-3"
                onClick={() => selectTab(t.id)}
              >
                {t.label}
              </Button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground ml-auto">
            {loading ? 'Loading…' : `${total} question${total === 1 ? '' : 's'}`}
          </span>
        </CardContent>
      </Card>

      {/* List */}
      <div className="space-y-3">
        {loading ? (
          <div className="space-y-3 animate-pulse">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-100 rounded-xl" />
            ))}
          </div>
        ) : questions.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-16 text-center max-w-md mx-auto">
              <HelpCircle className="w-12 h-12 mx-auto text-muted-foreground/30" />
              <p className="text-sm font-medium mt-3">{EMPTY_COPY[tab].title}</p>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{EMPTY_COPY[tab].desc}</p>
            </CardContent>
          </Card>
        ) : (
          questions.map(q => {
            const busy = busyId === q.id;
            const answered = q.answers.length > 0;
            return (
              <Card
                key={q.id}
                className={`border-0 shadow-sm transition-all ${!q.isPublished ? 'opacity-70' : ''} ${q.isPinned ? 'ring-2 ring-amber-300' : ''}`}
              >
                <CardContent className="p-4">
                  <div className="flex gap-3">
                    <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                      <HelpCircle className="w-4 h-4" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold">{q.askerName}</span>
                        {q.isPinned && (
                          <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1 border-amber-300 text-amber-700">
                            <Pin className="w-2.5 h-2.5" /> Pinned
                          </Badge>
                        )}
                        <Badge
                          className={`text-[10px] h-5 px-1.5 gap-1 ${
                            q.isPublished ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-700'
                          }`}
                        >
                          {q.isPublished ? <CheckCircle2 className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
                          {q.isPublished ? 'Published' : 'Pending'}
                        </Badge>
                        {!answered && (
                          <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-amber-300 text-amber-700">
                            Unanswered
                          </Badge>
                        )}
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1 ml-auto">
                          <Clock className="w-3 h-3" />
                          {new Date(q.createdAt).toLocaleDateString()}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground">
                        <ShoppingBag className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">
                          {q.product ? q.product.title : 'Not linked to a product'}
                        </span>
                      </div>

                      <p className="text-xs mt-2 leading-relaxed">{q.body}</p>

                      {answered && (
                        <div className="mt-3 space-y-2">
                          {q.answers.map(a => (
                            <div key={a.id} className="pl-3 border-l-2 border-emerald-500">
                              <p className="text-[11px] font-medium flex items-center gap-1.5">
                                <MessageSquare className="w-3 h-3 text-emerald-600" />
                                {a.authorName}
                                {a.authorType === 'merchant' && (
                                  <span className="text-[10px] px-1.5 py-px rounded-full bg-emerald-50 text-emerald-700">
                                    Store
                                  </span>
                                )}
                                <span className="text-[10px] text-muted-foreground font-normal">
                                  {new Date(a.createdAt).toLocaleDateString()}
                                </span>
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{a.body}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {composingFor === q.id ? (
                        <div className="mt-3">
                          <Textarea
                            className="text-xs min-h-[80px]"
                            placeholder="Answer the question in your own words. This is published to the storefront exactly as written."
                            value={drafts[q.id] || ''}
                            onChange={e => setDrafts(d => ({ ...d, [q.id]: e.target.value }))}
                            maxLength={5000}
                          />
                          <div className="flex items-center gap-2 mt-2">
                            <Button
                              size="sm"
                              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 gap-1.5"
                              disabled={busy}
                              onClick={() => submitAnswer(q.id)}
                            >
                              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                              Save &amp; publish
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => setComposingFor(null)}
                            >
                              Cancel
                            </Button>
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              Answering publishes the question — an unanswered question on a product page reads badly.
                            </span>
                          </div>
                        </div>
                      ) : (
                        <>
                          <Separator className="my-3" />
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1.5"
                              onClick={() => setComposingFor(q.id)}
                            >
                              <MessageSquare className="w-3 h-3" />
                              {answered ? 'Add another answer' : 'Answer'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1.5"
                              disabled={busy}
                              onClick={() =>
                                patch(
                                  q.id,
                                  { isPublished: !q.isPublished },
                                  q.isPublished ? 'Question unpublished' : 'Question published'
                                )
                              }
                            >
                              {q.isPublished ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              {q.isPublished ? 'Unpublish' : 'Publish'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1.5"
                              disabled={busy}
                              onClick={() =>
                                patch(q.id, { isPinned: !q.isPinned }, q.isPinned ? 'Unpinned' : 'Pinned to the top')
                              }
                            >
                              <Pin className={`w-3 h-3 ${q.isPinned ? 'text-amber-500 fill-amber-400' : ''}`} />
                              {q.isPinned ? 'Unpin' : 'Pin'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1.5 text-red-500 hover:text-red-600 ml-auto"
                              disabled={busy}
                              onClick={() => remove(q.id)}
                            >
                              <Trash2 className="w-3 h-3" /> Delete
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground px-2">Page {page} of {totalPages}</span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

# Podcast Library

A listener's followed podcasts, their personal categories, and episode discovery.

## Language

**Follow**:
A listener's relationship to a podcast in their library, including the categories they assign to it. Removing a follow does not remove another listener's follow of the same podcast.

**Category**:
A listener-owned grouping of followed podcasts. Categories supplied by a podcast's RSS metadata are descriptive context, not the listener's categories.

**Classification**:
A suggested category derived from a podcast's descriptive metadata, or no suggestion when no category fits.

**Categorisation**:
The assignment of listener-owned categories to a follow. Automatic categorisation applies a classification to a newly added, uncategorised follow; manual category choices take precedence.

**Episode**:
An individual release from a podcast, described by its title, publication details, and content metadata.

**Episode search**:
Finding episodes from a listener's followed podcasts using their stated criteria, rather than discovering other podcasts or inferring preferences from listening history.
_Avoid_: Personalised recommendation, podcast discovery

**Search criteria**:
A listener's topic and optional podcast, category, publication timeframe, and ordering preferences for an episode search. Follow-up requests can refine these criteria.

**Search snapshot**:
A listener's ordered set of matching episodes captured for stable search pagination. Membership and order are fixed for its lifetime; episode content and the listener's access can still change.

**Reranking**:
Reordering retrieved episodes using model-assessed relevance to the listener's search, without changing which episodes matched.

**Episode embedding**:
A representation of an episode's descriptive text used to find relevant episodes even when their wording differs from a listener's search.

**Query embedding**:
A representation of a listener's search text used for comparison with episode embeddings.

import { sourceCatalogSchema } from '@paperloop/contracts';

// Collections are data: adding a topic does not change scan orchestration.
export const sourceCatalog = sourceCatalogSchema.parse({
  sources: [
    {
      id: 'arxiv-ai',
      name: 'arXiv Artificial Intelligence',
      kind: 'arxiv',
      query: 'cat:cs.AI',
      coverage:
        'Historical and recent arXiv metadata; paginated up to offset 10,000.',
    },
    {
      id: 'arxiv-ml',
      name: 'arXiv Machine Learning',
      kind: 'arxiv',
      query: 'cat:cs.LG',
      coverage:
        'Historical and recent arXiv metadata; paginated up to offset 10,000.',
    },
    {
      id: 'arxiv-ir',
      name: 'arXiv Information Retrieval',
      kind: 'arxiv',
      query: 'cat:cs.IR',
      coverage:
        'Historical and recent arXiv metadata; paginated up to offset 10,000.',
    },
    {
      id: 'huggingface',
      name: 'Hugging Face blog',
      kind: 'feed',
      url: 'https://huggingface.co/blog/feed.xml',
      coverage:
        'Available feed history (first 200 entries), previously indexed articles, and submitted URLs. No complete historical web coverage.',
    },
  ],
  collections: [
    {
      id: 'retrieval',
      name: 'Retrieval',
      description: 'Search, ranking, and retrieval research.',
      sourceIds: ['arxiv-ir', 'huggingface'],
    },
    {
      id: 'agents',
      name: 'Agents',
      description: 'Agent and artificial intelligence research.',
      sourceIds: ['arxiv-ai', 'huggingface'],
    },
    {
      id: 'evaluation',
      name: 'Evaluation',
      description: 'Methods for measuring model quality.',
      sourceIds: ['arxiv-ml', 'arxiv-ai'],
    },
    {
      id: 'inference',
      name: 'Inference',
      description: 'Model execution and efficiency.',
      sourceIds: ['arxiv-ml', 'huggingface'],
    },
  ],
});

import { AudioLines, Play } from 'lucide-react'

import { m } from '#/paraglide/messages'

const podcasts = [
  {
    name: 'Syntax',
    hosts: 'Wes Bos & Scott Tolinski',
    categories: [{ label: m.category_development, color: 'blue' }],
    description: m.podcast_syntax_description,
    artwork: 'development',
  },
  {
    name: 'The Rest Is History',
    hosts: 'Tom Holland & Dominic Sandbrook',
    categories: [{ label: m.category_history, color: 'coral' }],
    description: m.podcast_history_description,
    artwork: 'history',
  },
  {
    name: 'CONFLICTED',
    hosts: 'Aimen Dean & Thomas Small',
    categories: [
      { label: m.category_world_affairs, color: 'green' },
      { label: m.category_history, color: 'coral' },
    ],
    description: m.podcast_conflicted_description,
    artwork: 'world',
  },
]

export function PodcastShowcase() {
  return (
    <section className="podcast-showcase" aria-labelledby="discovery-heading">
      <h1 id="discovery-heading">
        {m.discovery_heading_start()}
        <br />
        {m.discovery_heading_end()}
      </h1>
      <p className="showcase-subtitle">{m.discovery_subtitle()}</p>

      <ul className="podcast-list" aria-label={m.podcast_list_label()}>
        {podcasts.map((podcast) => (
          <li key={podcast.name} className="podcast-card">
            <div
              className={`podcast-artwork podcast-artwork--${podcast.artwork}`}
              aria-hidden="true"
            >
              <AudioLines aria-hidden="true" strokeWidth={1.25} />
              <span>{m.artwork_placeholder()}</span>
            </div>
            <div className="podcast-details">
              <h2>{podcast.name}</h2>
              <p className="podcast-hosts">{podcast.hosts}</p>
              <div className="podcast-categories">
                {podcast.categories.map((category) => (
                  <span key={category.color} className={`category category--${category.color}`}>
                    {category.label()}
                  </span>
                ))}
              </div>
              <p className="podcast-description">{podcast.description()}</p>
            </div>
            <span className="podcast-play" aria-hidden="true">
              <Play fill="currentColor" strokeWidth={0} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

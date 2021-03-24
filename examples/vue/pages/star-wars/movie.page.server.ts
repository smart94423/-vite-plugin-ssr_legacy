import fetch from 'node-fetch'
import { MovieDetails } from './types'

export { addContextProps }
export { setPageProps }

type ContextProps = {
  movieId: string
  movie: MovieDetails
  docTitle: string
}

async function addContextProps({
  contextProps
}: {
  contextProps: ContextProps
}): Promise<Partial<ContextProps>> {
  const filmId = contextProps.movieId
  const response = await fetch(`https://swapi.dev/api/films/${filmId}`)
  const movie = (await response.json()) as MovieDetails

  // The page's <title>
  const docTitle = movie.title

  return { movie, docTitle }
}

function setPageProps({
  contextProps: { movie, docTitle }
}: {
  contextProps: ContextProps
}) {
  // We remove data we don't need: (`vite-plugin-ssr` serializes and passes `pageProps`
  // to the client; we want to minimize what it sent over the network.)
  const { title, release_date, director, producer } = movie
  movie = { title, release_date, director, producer }
  return { movie, docTitle }
}

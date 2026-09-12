import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import {
  addFavourite,
  clearFavourites,
  importFavourites,
  listFavourites,
  removeFavourite,
} from '../lib/favourites.js';

/**
 * Favourites.
 *
 * Every route is about the caller's own hearts — none of them takes a user id,
 * so there is no favourites list anyone can reach but their own. Each write
 * returns the whole set back, which keeps the client from having to work out
 * what changed and makes an optimistic toggle easy to reconcile.
 */
export const favouriteRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/favourites', async (request) => ({
    favourites: await listFavourites(request.user!.id),
  }));

  app.put('/favourites/:kind/:id', async (request) => {
    const { kind, id } = request.params as { kind: string; id: string };
    return { favourites: await addFavourite(request.user!.id, kind, id) };
  });

  app.delete('/favourites/:kind/:id', async (request) => {
    const { kind, id } = request.params as { kind: string; id: string };
    return { favourites: await removeFavourite(request.user!.id, kind, id) };
  });

  /** Empties the lot. Deliberately separate from removing one. */
  app.delete('/favourites', async (request) => clearFavourites(request.user!.id));

  /**
   * Folds in whatever a browser was still holding from before favourites were
   * kept on the server. Safe to call more than once.
   */
  app.post('/favourites/import', async (request) => ({
    favourites: await importFavourites(request.user!.id, request.body),
  }));
};

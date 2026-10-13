import type { ProductChildCustomPage, ProductMetadata } from '@shell/core/plugin-products-external';
import { PAGES, PRODUCT_NAME } from './constants';

// Same value as IF_HAVE.ADMIN in @shell/store/type-map. Importing that module from the entry point
// bundles a large part of the shell (lodash, table headers, prefs...) into the eager chunk.
const IF_HAVE_ADMIN = 'admin-user';

export const product: ProductMetadata = {
  name:      PRODUCT_NAME,
  labelKey:  'spr.product.label',
  // POC: admins only until RBAC is designed (connections live in cattle-global-data)
  enable:    { ifHave: IF_HAVE_ADMIN },
  sideBar:   { icon: { name: 'storage' } },
  resources: { store: 'management' },
};

// Higher weight = higher in the side menu
export const pages: ProductChildCustomPage[] = [
  {
    name:      PAGES.REGISTRIES,
    labelKey:  'spr.nav.registries',
    component: () => import('../pages/RegistriesList.vue'),
    sideMenu:  { weight: 40 },
  },
  {
    name:      PAGES.OVERVIEW,
    labelKey:  'spr.nav.overview',
    component: () => import('../pages/SprOverview.vue'),
    sideMenu:  { weight: 30 },
  },
  {
    name:      PAGES.PROJECTS,
    labelKey:  'spr.nav.projects',
    component: () => import('../pages/ProjectsList.vue'),
    sideMenu:  { weight: 20 },
  },
  {
    name:      PAGES.REPOSITORIES,
    labelKey:  'spr.nav.repositories',
    component: () => import('../pages/RepositoriesList.vue'),
    sideMenu:  { weight: 15 },
  },
  {
    name:      PAGES.SETTINGS,
    labelKey:  'spr.nav.settings',
    component: () => import('../pages/SprSettings.vue'),
    sideMenu:  { weight: 10 },
  },
];

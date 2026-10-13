import { importTypes } from '@rancher/auto-import';
import { IPlugin, TabLocation } from '@shell/core/types';
import { DETAIL_ROUTES, PRODUCT_NAME, WORKLOAD_TAB_TYPES } from './config/constants';
import { pages, product } from './config/product';

// Init the package
export default function(plugin: IPlugin): void {
  // Auto-import model, detail, edit from the folders
  importTypes(plugin);

  // Provide plugin metadata from package.json
  plugin.metadata = require('./package.json');

  // Top-level product with side menu pages (routes `spr-c-cluster-<page>`)
  plugin.addProduct(product, pages);

  // Drill-down pages need route params, which the Product Registration API doesn't support.
  // Same path/name scheme as the generated routes so the product side menu stays active.
  const base = `${ PRODUCT_NAME }/c/:cluster/projects/:project`;
  const meta = { product: PRODUCT_NAME };

  plugin.addRoute('default', {
    name:      DETAIL_ROUTES.PROJECT,
    path:      base,
    component: () => import('./pages/ProjectDetail.vue'),
    meta,
  });
  plugin.addRoute('default', {
    name:      DETAIL_ROUTES.REPOSITORY,
    path:      `${ base }/repositories/:repo`,
    component: () => import('./pages/RepositoryDetail.vue'),
    meta,
  });
  plugin.addRoute('default', {
    name:      DETAIL_ROUTES.ARTIFACT,
    path:      `${ base }/repositories/:repo/artifacts/:digest`,
    component: () => import('./pages/ArtifactDetail.vue'),
    meta,
  });

  // "Image security" tab on workload and pod detail pages
  plugin.addTab(TabLocation.RESOURCE_DETAIL_PAGE, { resource: WORKLOAD_TAB_TYPES }, {
    name:      'spr-image-security',
    labelKey:  'spr.tabs.imageSecurity',
    weight:    -5,
    component: () => import('./components/tabs/ImageSecurityTab.vue'),
  });
}

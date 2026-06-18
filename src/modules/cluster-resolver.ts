import inquirer from 'inquirer';
import Separator from 'inquirer/lib/objects/separator.js';
import { ClusterEntry, AccountEntry, ClusterRegistry, ResolvedCluster } from '../types.js';
import { ExitError } from '../errors.js';
import { EXIT_CODES } from '../constants.js';

interface ClusterWithAccount {
  cluster: ClusterEntry;
  account: AccountEntry;
}

/**
 * Resolves a cluster name query to a specific cluster entry with its parent account context.
 *
 * Resolution logic:
 * 1. If query provided: exact match → select; single substring → auto-select;
 *    multiple matches + interactive → prompt; multiple + non-interactive → error;
 *    no match → error listing available names.
 * 2. If no query: interactive → prompt with grouped list; non-interactive → error.
 *
 * @param query - Cluster name or partial name to search for
 * @param registry - The loaded cluster registry
 * @param interactive - Whether stdin is a TTY (allows prompting)
 * @returns The resolved cluster and its parent account
 * @throws ExitError(1) on no match, ambiguous non-interactive, or missing query non-interactive
 */
export async function resolveCluster(
  query: string | undefined,
  registry: ClusterRegistry,
  interactive: boolean
): Promise<ResolvedCluster> {
  // Build flat list of all clusters with their parent accounts
  const allClusters: ClusterWithAccount[] = [];
  for (const account of registry.accounts) {
    for (const cluster of account.clusters) {
      allClusters.push({ cluster, account });
    }
  }

  if (query) {
    return resolveWithQuery(query, allClusters, interactive);
  } else {
    return resolveWithoutQuery(allClusters, registry, interactive);
  }
}

/**
 * Resolves when a query string is provided.
 */
async function resolveWithQuery(
  query: string,
  allClusters: ClusterWithAccount[],
  interactive: boolean
): Promise<ResolvedCluster> {
  // Find exact matches
  const exactMatches = allClusters.filter(({ cluster }) => cluster.name === query);

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  // If no exact match, find substring matches
  if (exactMatches.length === 0) {
    const substringMatches = allClusters.filter(({ cluster }) =>
      cluster.name.includes(query)
    );

    if (substringMatches.length === 1) {
      return substringMatches[0];
    }

    if (substringMatches.length > 1) {
      return handleMultipleMatches(query, substringMatches, interactive);
    }

    // No matches at all
    const availableNames = allClusters.map(({ cluster }) => cluster.name).join(', ');
    throw new ExitError(
      EXIT_CODES.GENERAL_ERROR,
      `No cluster matching '${query}'. Available clusters: ${availableNames}`
    );
  }

  // Multiple exact matches (unlikely but handle gracefully)
  return handleMultipleMatches(query, exactMatches, interactive);
}

/**
 * Handles the case where multiple clusters match the query.
 */
async function handleMultipleMatches(
  query: string,
  matches: ClusterWithAccount[],
  interactive: boolean
): Promise<ResolvedCluster> {
  if (!interactive) {
    const names = matches.map(({ cluster }) => cluster.name).join(', ');
    throw new ExitError(
      EXIT_CODES.GENERAL_ERROR,
      `Multiple clusters match '${query}': ${names}. Please be more specific.`
    );
  }

  // Interactive: prompt user to select
  const choices = matches.map(({ cluster, account }) => ({
    name: `${cluster.name} (${account.accountName})`,
    value: { cluster, account },
  }));

  const { selected } = await inquirer.prompt<{ selected: ResolvedCluster }>([
    {
      type: 'list',
      name: 'selected',
      message: `Multiple clusters match '${query}'. Select one:`,
      choices,
    },
  ]);

  return selected;
}

/**
 * Resolves when no query is provided.
 */
async function resolveWithoutQuery(
  allClusters: ClusterWithAccount[],
  registry: ClusterRegistry,
  interactive: boolean
): Promise<ResolvedCluster> {
  if (!interactive) {
    throw new ExitError(
      EXIT_CODES.GENERAL_ERROR,
      'No cluster name provided.'
    );
  }

  // Interactive: display numbered list grouped by account
  const choices: Array<{ name: string; value: ResolvedCluster } | { type: 'separator'; line: string }> = [];

  for (const account of registry.accounts) {
    choices.push(new Separator(`── ${account.accountName} (${account.accountId}) ──`) as any);
    for (const cluster of account.clusters) {
      choices.push({
        name: `  ${cluster.name}`,
        value: { cluster, account },
      });
    }
  }

  const { selected } = await inquirer.prompt<{ selected: ResolvedCluster }>([
    {
      type: 'list',
      name: 'selected',
      message: 'Select a cluster:',
      choices: choices as any,
    },
  ]);

  return selected;
}

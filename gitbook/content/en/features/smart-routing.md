# Routing Strategies and Fallback

9Router can distribute requests across provider accounts and route requests through a combo of models. These are separate settings: account routing chooses between connections to a provider, while combo routing chooses between models in a combo.

## Account routing

Open **Dashboard → Profile → Routing Strategy**.

- **Round Robin** off uses accounts in priority order (Fill First). Turn it on to cycle through accounts.
- **Sticky Limit** appears when Round Robin is on. It controls how many calls use an account before switching to the next one.

## Combo routing

A combo is a named list of models that you configure in **Dashboard → Combos**. You can use the combo name as the model in a request. See [Combos](./combos.md) for creating and using a combo.

In **Dashboard → Profile → Routing Strategy**, the global combo controls apply when a combo does not have its own strategy override:

- **Combo Round Robin** off starts with the first model in the combo. Turn it on to rotate the starting model across requests.
- **Combo Sticky Limit** appears when Combo Round Robin is on. It controls how many calls use a combo model before switching to the next one.

The Combos page also provides per-combo strategy settings:

- **Fallback** tries the configured models in order when a request can fall back.
- **Round Robin** rotates models across requests.
- **Smart Router** uses a System One decision model to select a model. Its policy can be configured on the combo.
- **Fusion** runs a panel of models with a judge.

Fallback depends on the response and available models; it is not a guarantee that every request will succeed. Configure the models and ordering you want rather than assuming that 9Router automatically selects subscription, low-cost, and free tiers.

## Monitoring usage

Use the dashboard's usage and quota views to inspect available usage information. Provider quotas, reset times, and costs vary; check the provider's own limits and pricing before relying on them.

## Related

- [Combos](./combos.md) — configure model combinations and fallback.
- [Quota Tracking](./quota-tracking.md) — inspect provider quota information.

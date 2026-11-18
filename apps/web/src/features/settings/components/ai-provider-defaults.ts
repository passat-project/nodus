/** Пары «провайдер + модель» после окна провайдера. */
export interface ProviderDefaults {
  defaultProviderId: string | null;
  defaultModelId: string | null;
  routerProviderId: string | null;
  routerModelId: string | null;
}

/**
 * Окно провайдера управляет ДВУМЯ необязательными парами: основная модель
 * портала и модель-диспетчер (#917). Тумблер назначает пару на этого
 * провайдера; снятие на текущем — очищает; чужую пару окно не трогает.
 */
export function resolveProviderDefaults(input: {
  editingId: string;
  defaultProviderId: string | null;
  defaultModelId: string | null;
  routerProviderId: string | null;
  routerModelId: string | null;
  isDefault: boolean;
  pickedModel: string | null;
  isRouter: boolean;
  routerModel: string | null;
}): ProviderDefaults {
  const pair = (
    isOn: boolean,
    modelId: string | null,
    currentProviderId: string | null,
    currentModelId: string | null,
  ): { providerId: string | null; modelId: string | null } => {
    if (isOn) return { providerId: input.editingId, modelId };
    if (input.editingId === currentProviderId) return { providerId: null, modelId: null };
    return { providerId: currentProviderId, modelId: currentModelId };
  };
  const main = pair(
    input.isDefault,
    input.pickedModel,
    input.defaultProviderId,
    input.defaultModelId,
  );
  const router = pair(
    input.isRouter,
    input.routerModel,
    input.routerProviderId,
    input.routerModelId,
  );
  return {
    defaultProviderId: main.providerId,
    defaultModelId: main.modelId,
    routerProviderId: router.providerId,
    routerModelId: router.modelId,
  };
}

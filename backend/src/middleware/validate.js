/** Zod request validation. Parsed (and coerced) values replace the raw input. */
export const validateBody = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) return next(result.error);
  req.body = result.data;
  return next();
};

export const validateQuery = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.query ?? {});
  if (!result.success) return next(result.error);
  req.validatedQuery = result.data;
  return next();
};

export const validateParams = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.params ?? {});
  if (!result.success) return next(result.error);
  req.params = { ...req.params, ...result.data };
  return next();
};

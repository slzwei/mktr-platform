export const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    details: 'The requested endpoint does not exist'
  });
};

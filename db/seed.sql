INSERT INTO employees (name)
VALUES
  ('Heang'),
  ('Riya'),
  ('Kdey'),
  ('Chi Vorn'),
  ('Nith'),
  ('Savath')
ON CONFLICT (name) DO NOTHING;

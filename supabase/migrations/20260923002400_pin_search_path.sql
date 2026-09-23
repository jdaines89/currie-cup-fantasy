-- Security advisor: pin the search path so is_rugby_score can't be pointed at
-- a lookalike function. Behaviour is unchanged.
alter function public.is_rugby_score(int) set search_path = '';

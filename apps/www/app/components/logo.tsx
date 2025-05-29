import { AiOutlineThunderbolt } from 'react-icons/ai';
import { NavLink } from 'react-router';

export function Logo() {
  return (
    <NavLink to="/" className="flex items-center gap-x-2">
      <AiOutlineThunderbolt className="fill-primary size-6" />
      <p className="!text-primary font-mono font-bold md:text-lg">SDK-IT</p>
    </NavLink>
  );
}

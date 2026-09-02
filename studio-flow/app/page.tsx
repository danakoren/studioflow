import { redirect } from 'next/navigation';

/** The schedule is the front door of the product. */
export default function HomePage() {
  redirect('/schedule');
}

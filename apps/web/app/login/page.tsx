import { Suspense } from "react";

import { LoginPage } from "@/components/login-page";

export default function Page() {
  // useSearchParams (for the post-login `?next=` redirect) needs a Suspense boundary.
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  );
}

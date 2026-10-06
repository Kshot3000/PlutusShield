import { Compare } from "@/components/landing/Compare";
import { CoverTypes } from "@/components/landing/CoverTypes";
import { CTA } from "@/components/landing/CTA";
import { DualChain } from "@/components/landing/DualChain";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Problem } from "@/components/landing/Problem";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Problem />
      <DualChain />
      <CoverTypes />
      <HowItWorks />
      <Compare />
      <CTA />
    </>
  );
}

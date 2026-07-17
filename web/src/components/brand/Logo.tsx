/// The V-mark from vampchain-brand-kit/v-mark-primary.svg, inlined so its
/// main shape can inherit `currentColor` (for monochrome contexts) while
/// the two fang accents stay brand-red per the kit's logo rules. Viewbox
/// and path data are copied verbatim from the kit — do not redraw by hand.
export function Logo({
  className,
  monochrome = false,
}: {
  className?: string;
  monochrome?: boolean;
}) {
  return (
    <svg viewBox="0 0 512 512" className={className} fill="none" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M48 72C105 98 155 116 205 119C226 121 245 132 256 147C267 132 286 121 307 119C357 116 407 98 464 72L256 452Z
           M256 179C241 158 220 153 204 165C188 177 184 199 192 223L256 344L320 223C328 199 324 177 308 165C292 153 271 158 256 179Z"
      />
      {!monochrome && (
        <>
          <path fill="#E22D3A" d="M191 215 L205 236 L198 281 Z" />
          <path fill="#E22D3A" d="M321 215 L307 236 L314 281 Z" />
        </>
      )}
    </svg>
  );
}

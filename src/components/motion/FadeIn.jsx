// Content that has just arrived (replacing its skeleton) fades in once, as a whole.
// No stagger, no movement, nothing tied to scrolling (.fade-in in storefront-motion.css).
export function FadeIn({ as: Tag = 'div', className, children, ...props }) {
  return (
    <Tag className={className ? `fade-in ${className}` : 'fade-in'} {...props}>
      {children}
    </Tag>
  );
}

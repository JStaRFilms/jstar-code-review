export function DangerousHtml({ html }: { html: string }) {
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

// Hashtag filtering utilities for campaign videos
// Used to filter posts by required hashtags in campaign metrics

export function hasRequiredHashtag(
  text: string | null | undefined,
  requiredHashtags: string[] | null | undefined
): boolean {
  // If no hashtags required, include all posts
  if (!requiredHashtags || requiredHashtags.length === 0) {
    return true;
  }

  // If no text provided, exclude post
  if (!text) {
    return false;
  }

  // Normalize text to lowercase for case-insensitive matching
  const normalizedText = text.toLowerCase();

  // Check if text contains at least one of the required hashtags
  return requiredHashtags.some(hashtag => {
    const normalizedHashtag = hashtag.toLowerCase().trim();
    // Remove leading # if not present in search
    const hashtagWithHash = normalizedHashtag.startsWith('#') 
      ? normalizedHashtag 
      : `#${normalizedHashtag}`;
    const hashtagWithoutHash = normalizedHashtag.replace(/^#+/, '');
    
    // Match either #hashtag or hashtag (word boundary)
    return normalizedText.includes(hashtagWithHash) || 
           new RegExp(`\\b${hashtagWithoutHash}\\b`, 'i').test(normalizedText);
  });
}

export function extractHashtags(text: string | null | undefined): string[] {
  if (!text) return [];
  
  // Match hashtags: # followed by word characters
  const hashtagRegex = /#[\w\u0400-\u04FF]+/g;
  const matches = text.match(hashtagRegex) || [];
  
  return matches.map(tag => tag.toLowerCase());
}

// ResQ mobile app integration helper.
// Use this in React Native, Expo, or any mobile client that can call fetch().

async function fetchLatestAnnouncements(apiBaseUrl, options = {}) {
  const params = new URLSearchParams({
    limit: String(options.limit || 20),
    ...(options.category ? { category: options.category } : {}),
    ...(options.targetAudience ? { targetAudience: options.targetAudience } : {})
  });

  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}/api/news?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Unable to fetch ResQ announcements: ${response.status}`);
  }

  return await response.json();
}

if (typeof module !== "undefined") {
  module.exports = { fetchLatestAnnouncements };
}

// React Native FlatList example:
//
// const [refreshing, setRefreshing] = useState(false);
// const [announcements, setAnnouncements] = useState([]);
//
// async function refreshAnnouncements() {
//   setRefreshing(true);
//   try {
//     setAnnouncements(await fetchLatestAnnouncements(API_BASE_URL));
//   } finally {
//     setRefreshing(false);
//   }
// }
//
// <FlatList
//   data={announcements}
//   keyExtractor={(item) => item.id}
//   refreshing={refreshing}
//   onRefresh={refreshAnnouncements}
//   renderItem={({ item }) => (
//     <AnnouncementCard
//       imageUrl={item.imageUrl ? `${API_BASE_URL}${item.imageUrl}` : ""}
//       title={item.title}
//       message={item.message}
//       priority={item.priority}
//       category={item.category}
//     />
//   )}
// />

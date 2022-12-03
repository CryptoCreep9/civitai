import { Carousel } from '@mantine/carousel';
import {
  ActionIcon,
  Badge,
  Button,
  Center,
  Container,
  createStyles,
  Grid,
  Group,
  Loader,
  Menu,
  MultiSelect,
  Select,
  Stack,
  Text,
  Title,
  useMantineTheme,
  Modal,
  Alert,
  ThemeIcon,
  Paper,
  Tooltip,
  Rating,
} from '@mantine/core';
import { closeAllModals, openConfirmModal, openContextModal } from '@mantine/modals';
import { NextLink } from '@mantine/next';
import { hideNotification, showNotification } from '@mantine/notifications';
import { ModelStatus, ReportReason } from '@prisma/client';
import {
  IconArrowsSort,
  IconBan,
  IconDotsVertical,
  IconEdit,
  IconExclamationMark,
  IconFilter,
  IconFlag,
  IconHeart,
  IconLicense,
  IconPlus,
  IconShield,
  IconTrash,
} from '@tabler/icons';
import startCase from 'lodash/startCase';
import { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { InView } from 'react-intersection-observer';

import { NotFound } from '~/components/AppLayout/NotFound';
import { ContentClamp } from '~/components/ContentClamp/ContentClamp';
import {
  DescriptionTable,
  type Props as DescriptionTableProps,
} from '~/components/DescriptionTable/DescriptionTable';
import { getEdgeUrl } from '~/components/EdgeImage/EdgeImage';
import { ImagePreview } from '~/components/ImagePreview/ImagePreview';
import { LoginRedirect } from '~/components/LoginRedirect/LoginRedirect';
import { Meta } from '~/components/Meta/Meta';
import { ModelForm } from '~/components/Model/ModelForm/ModelForm';
import { ModelRating } from '~/components/ModelRating/ModelRating';
import { ModelReviews } from '~/components/Model/ModelReviews/ModelReviews';
import { ModelVersions } from '~/components/Model/ModelVersions/ModelVersions';
import { RenderHtml } from '~/components/RenderHtml/RenderHtml';
import { SensitiveShield } from '~/components/SensitiveShield/SensitiveShield';
import { TrainingWordBadge } from '~/components/TrainingWordBadge/TrainingWordBadge';
import { UserAvatar } from '~/components/UserAvatar/UserAvatar';
import { VerifiedShield } from '~/components/VerifiedShield/VerifiedShield';
import { useIsMobile } from '~/hooks/useIsMobile';
import { ReviewFilter, ReviewSort } from '~/server/common/enums';
import { getServerProxySSGHelpers } from '~/server/utils/getServerProxySSGHelpers';
import { formatDate } from '~/utils/date-helpers';
import { showErrorNotification, showSuccessNotification } from '~/utils/notifications';
import { abbreviateNumber, formatKBytes } from '~/utils/number-helpers';
import { QS } from '~/utils/qs';
import { splitUppercase, removeTags } from '~/utils/string-helpers';
import { trpc } from '~/utils/trpc';
import { isNumber } from '~/utils/type-guards';
import { IconBadge } from '~/components/IconBadge/IconBadge';
import { useInfiniteModelsFilters } from '~/components/InfiniteModels/InfiniteModelsFilters';
import { VerifiedText } from '~/components/VerifiedText/VerifiedText';
import { scrollToTop } from '~/utils/scroll-utils';

//TODO - Break model query into multiple queries
/*
  - model details
  - model rank
  - model reviews
  - model-version (only fetch latest model version)
  - model-version rank
  - model-version reviews (for users who only want to see reviews for specific versions)
*/

export const getServerSideProps: GetServerSideProps<{
  id: number;
  slug: string | string[] | null;
}> = async (context) => {
  const params = (context.params ?? {}) as { id: string; slug: string[] };
  const id = Number(params.id);
  if (!isNumber(id))
    return {
      notFound: true,
    };

  const ssg = await getServerProxySSGHelpers(context);
  await ssg.model.getById.prefetch({ id });

  return {
    props: {
      trpcState: ssg.dehydrate(),
      id,
      slug: params.slug?.[0] ?? '',
    },
  };
};

const useStyles = createStyles((theme) => ({
  actions: {
    [theme.fn.smallerThan('sm')]: {
      width: '100%',
    },
  },

  title: {
    [theme.fn.smallerThan('sm')]: {
      fontSize: theme.fontSizes.xs * 2.4, // 24px
    },
  },

  engagementBar: {
    [theme.fn.smallerThan('sm')]: {
      display: 'none',
    },
  },
}));

export default function ModelDetail(props: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const theme = useMantineTheme();
  const router = useRouter();
  const { data: session } = useSession();
  const { classes } = useStyles();
  const mobile = useIsMobile();
  const queryUtils = trpc.useContext();
  const filters = useInfiniteModelsFilters();

  const { id, slug } = props;
  const { edit } = router.query;

  const reviewSectionRef = useRef<HTMLDivElement | null>(null);
  const [reviewFilters, setReviewFilters] = useState<{
    filterBy: ReviewFilter[];
    sort: ReviewSort;
  }>({
    filterBy: [],
    sort: ReviewSort.Newest,
  });

  const { data: model, isLoading: loadingModel } = trpc.model.getById.useQuery({ id });
  const { data: favoriteModels = [] } = trpc.user.getFavoriteModels.useQuery(undefined, {
    enabled: !!session,
    cacheTime: Infinity,
    staleTime: Infinity,
  });
  const {
    data: reviewsData,
    isLoading: loadingReviews,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = trpc.review.getAll.useInfiniteQuery(
    { modelId: id, limit: 5, ...reviewFilters },
    {
      enabled: !edit,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      keepPreviousData: true,
    }
  );

  const nsfw =
    session?.user?.blurNsfw !== false && router.query.showNsfw !== 'true' && model?.nsfw === true;
  const isFavorite = favoriteModels.find((favorite) => favorite.modelId === id);

  const deleteMutation = trpc.model.delete.useMutation({
    onSuccess() {
      showSuccessNotification({
        title: 'Your model has been deleted',
        message: 'Successfully deleted the model',
      });
      closeAllModals();
      router.replace('/'); // Redirect to the models or user page once available
    },
    onError(error) {
      showErrorNotification({
        error: new Error(error.message),
        title: 'Could not delete model',
        reason: 'An unexpected error occurred, please try again',
      });
    },
  });
  const reportModelMutation = trpc.model.report.useMutation({
    onMutate() {
      showNotification({
        id: 'sending-report',
        loading: true,
        disallowClose: true,
        autoClose: false,
        message: 'Sending report...',
      });
    },
    async onSuccess(_, variables) {
      showSuccessNotification({
        title: 'Model reported',
        message: 'Your request has been received',
      });
      await queryUtils.model.getById.invalidate({ id: variables.id });
    },
    onError(error) {
      showErrorNotification({
        error: new Error(error.message),
        title: 'Unable to send report',
        reason: 'An unexpected error occurred, please try again',
      });
    },
    onSettled() {
      hideNotification('sending-report');
    },
  });
  const unpublishModelMutation = trpc.model.unpublish.useMutation({
    async onSuccess() {
      await queryUtils.model.getById.invalidate({ id });
    },
    onError(error) {
      showErrorNotification({ error: new Error(error.message) });
    },
  });
  const toggleFavoriteModelMutation = trpc.user.toggleFavorite.useMutation({
    async onMutate({ modelId }) {
      await queryUtils.user.getFavoriteModels.cancel();

      const previousFavorites = queryUtils.user.getFavoriteModels.getData() ?? [];
      const previousModel = queryUtils.model.getById.getData({ id: modelId });
      const shouldRemove = previousFavorites.find((favorite) => favorite.modelId === modelId);
      // Update the favorite count
      queryUtils.model.getById.setData({ id: modelId }, (model) => {
        if (model?.rank) model.rank.favoriteCountAllTime += shouldRemove ? -1 : 1;
        return model;
      });
      // Remove from favorites list
      queryUtils.user.getFavoriteModels.setData(undefined, (old = []) =>
        shouldRemove
          ? old.filter((favorite) => favorite.modelId !== modelId)
          : [...old, { modelId }]
      );

      return { previousFavorites, previousModel };
    },
    async onSuccess() {
      await queryUtils.model.getAll.invalidate({ favorites: true });
      queryUtils.model.getAll.setInfiniteData({ ...filters, favorites: true }, (oldData) => {
        return { pageParams: [], pages: [] };
      });
    },
    onError(_error, _variables, context) {
      queryUtils.user.getFavoriteModels.setData(undefined, context?.previousFavorites);
      if (context?.previousModel?.id)
        queryUtils.model.getById.setData(
          { id: context?.previousModel?.id },
          context?.previousModel
        );
    },
  });

  const reviews = useMemo(
    () => reviewsData?.pages.flatMap((x) => x.reviews) ?? [],
    [reviewsData?.pages]
  );
  const isModerator = session?.user?.isModerator ?? false;
  const isOwner = model?.user.id === session?.user?.id || isModerator;

  // when a user navigates back in their browser, set the previous url with the query string model={id}
  useEffect(() => {
    router.beforePopState(({ as }) => {
      if (as === '/' || as.startsWith('/?') || as.startsWith('/user/')) {
        const [route, queryString] = as.split('?');
        const queryParams = QS.parse(queryString);
        setTimeout(() => {
          router.replace({ pathname: route, query: { ...queryParams, model: id } }, undefined, {
            shallow: true,
          });
        }, 0);
      }
      return true;
    });

    return () => router.beforePopState(() => true);
  }, [router, id]); // Add any state variables to dependencies array if needed.

  // Latest version is the first one based on sorting (createdAt - desc)
  const latestVersion = model?.modelVersions[0];

  if (loadingModel)
    return (
      <Container size="xl">
        <Center>
          <Loader size="xl" />
        </Center>
      </Container>
    );
  if (!model) return <NotFound />;
  if (!!edit && model && isOwner) return <ModelForm model={model} />;
  if (model.nsfw && !session) return <SensitiveShield redirectTo={router.asPath} />;

  const handleDeleteModel = () => {
    openConfirmModal({
      title: 'Delete Model',
      children: (
        <Text size="sm">
          Are you sure you want to delete this model? This action is destructive and you will have
          to contact support to restore your data.
        </Text>
      ),
      centered: true,
      labels: { confirm: 'Delete Model', cancel: "No, don't delete it" },
      confirmProps: { color: 'red', loading: deleteMutation.isLoading },
      closeOnConfirm: false,
      onConfirm: () => {
        if (model) {
          deleteMutation.mutate({ id: model.id });
        }
      },
    });
  };

  const handleReviewFilterChange = (values: ReviewFilter[]) => {
    setReviewFilters((current) => ({
      ...current,
      filterBy: values,
    }));
  };

  const handleReviewSortChange = (value: ReviewSort) => {
    setReviewFilters((current) => ({
      ...current,
      sort: value,
    }));
  };

  const handleReportModel = (reason: ReportReason) => {
    reportModelMutation.mutate({ id, reason });
  };

  const handleUnpublishModel = () => {
    unpublishModelMutation.mutate({ id });
  };

  const handleToggleFavorite = () => {
    toggleFavoriteModelMutation.mutate({ modelId: id });
  };

  const modelDetails: DescriptionTableProps['items'] = [
    {
      label: 'Type',
      value: (
        <Group position="apart">
          <Badge radius="sm">{splitUppercase(model?.type)}</Badge>
          {model?.status !== ModelStatus.Published && (
            <Badge color="yellow" radius="sm">
              {model.status}
            </Badge>
          )}
        </Group>
      ),
    },
    {
      label: 'Downloads',
      value: <Text>{(model?.rank?.downloadCountAllTime ?? 0).toLocaleString()}</Text>,
    },
    {
      label: 'Last Update',
      value: <Text>{formatDate(model?.updatedAt)}</Text>,
    },
    {
      label: 'Versions',
      value: <Text>{model?.modelVersions.length}</Text>,
    },
    {
      label: 'Tags',
      value: (
        <Group spacing={4}>
          {model.tagsOnModels.map(({ tag }) => (
            <Link key={tag.id} href={`/?tag=${tag.name}`} passHref>
              <Badge
                key={tag.id}
                color={tag.color ?? 'blue'}
                component="a"
                size="sm"
                radius="sm"
                sx={{ cursor: 'pointer' }}
              >
                {tag.name}
              </Badge>
            </Link>
          ))}
        </Group>
      ),
    },
    {
      label: 'Trained Words',
      visible: !!latestVersion?.trainedWords?.length,
      value: (
        <Group spacing={4}>
          {latestVersion?.trainedWords.map((word, index) => (
            <TrainingWordBadge key={index} word={word} />
          ))}
        </Group>
      ),
    },
    {
      label: 'Uploaded By',
      value: model.user && (
        <Link href={`/?username=${model.user.username}`} passHref>
          <Text size="sm" variant="link" component="a" style={{ cursor: 'pointer' }}>
            <Group align="center" spacing={4}>
              <UserAvatar user={model.user} avatarProps={{ size: 'sm' }} />
              {model.user.username}
            </Group>
          </Text>
        </Link>
      ),
    },
  ];
  const published = model.status === ModelStatus.Published;

  return (
    <>
      <Meta
        title={`Civitai - ${model.name}`}
        description={removeTags(model.description ?? '')}
        image={
          (model.nsfw && !router.query['showNsfw']) || latestVersion?.images[0]?.image.url == null
            ? undefined
            : getEdgeUrl(latestVersion.images[0].image.url, { width: 1200 })
        }
      />

      <Container size="xl" pt={0} pb="xl" px={0}>
        <Stack spacing="xs" mb="xl">
          <Group align="center" sx={{ justifyContent: 'space-between' }} noWrap>
            <Group align="center" spacing={mobile ? 4 : 'xs'}>
              <Title
                className={classes.title}
                order={1}
                sx={{ paddingBottom: mobile ? 0 : 8, width: mobile ? '100%' : undefined }}
              >
                {model?.name}
              </Title>
              <LoginRedirect reason="favorite-model">
                <IconBadge
                  radius="sm"
                  color={isFavorite ? 'red' : 'gray'}
                  size="lg"
                  icon={
                    <IconHeart
                      size={18}
                      color={isFavorite ? theme.colors.red[6] : undefined}
                      style={{ fill: isFavorite ? theme.colors.red[6] : undefined }}
                    />
                  }
                  sx={{ cursor: 'pointer' }}
                  onClick={() => handleToggleFavorite()}
                >
                  <Text size={mobile ? 'sm' : 'md'}>
                    {abbreviateNumber(model.rank?.favoriteCountAllTime ?? 0)}
                  </Text>
                </IconBadge>
              </LoginRedirect>
              <IconBadge
                radius="sm"
                color="gray"
                size="lg"
                icon={<Rating value={model.rank?.ratingAllTime ?? 0} readOnly />}
                sx={{ cursor: 'pointer' }}
                onClick={() => {
                  if (!reviewSectionRef.current) return;
                  scrollToTop(reviewSectionRef.current);
                }}
              >
                <Text size={mobile ? 'sm' : 'md'}>
                  {abbreviateNumber(model.rank?.ratingCountAllTime ?? 0)}
                </Text>
              </IconBadge>
            </Group>
            <Menu position="bottom-end" transition="pop-top-right">
              <Menu.Target>
                <ActionIcon variant="outline">
                  <IconDotsVertical size={16} />
                </ActionIcon>
              </Menu.Target>

              <Menu.Dropdown>
                {session && isOwner ? (
                  <>
                    <Menu.Item
                      color={theme.colors.red[6]}
                      icon={<IconTrash size={14} stroke={1.5} />}
                      onClick={handleDeleteModel}
                    >
                      Delete Model
                    </Menu.Item>
                    <Menu.Item
                      component={NextLink}
                      href={`/models/${id}/${slug}?edit=true`}
                      icon={<IconEdit size={14} stroke={1.5} />}
                      shallow
                    >
                      Edit Model
                    </Menu.Item>
                  </>
                ) : null}
                {session && isOwner && published ? (
                  <Menu.Item
                    icon={<IconBan size={14} stroke={1.5} />}
                    color="yellow"
                    onClick={handleUnpublishModel}
                    disabled={unpublishModelMutation.isLoading}
                  >
                    Unpublish
                  </Menu.Item>
                ) : null}
                {!session || !isOwner || isModerator ? (
                  <>
                    <LoginRedirect reason="report-model">
                      <Menu.Item
                        icon={<IconFlag size={14} stroke={1.5} />}
                        onClick={() => handleReportModel(ReportReason.NSFW)}
                        disabled={reportModelMutation.isLoading}
                      >
                        Report as NSFW
                      </Menu.Item>
                    </LoginRedirect>
                    <LoginRedirect reason="report-model">
                      <Menu.Item
                        icon={<IconFlag size={14} stroke={1.5} />}
                        onClick={() => handleReportModel(ReportReason.TOSViolation)}
                        disabled={reportModelMutation.isLoading}
                      >
                        Report as Terms Violation
                      </Menu.Item>
                    </LoginRedirect>
                  </>
                ) : null}
              </Menu.Dropdown>
            </Menu>
          </Group>
          {model.status === ModelStatus.Unpublished && (
            <Alert color="red">
              <Group spacing="xs" noWrap align="flex-start">
                <ThemeIcon color="red">
                  <IconExclamationMark />
                </ThemeIcon>
                <Text size="md">
                  This model has been unpublished because it looks like the model file failed to
                  upload. Please re-upload the file.
                </Text>
              </Group>
            </Alert>
          )}
        </Stack>
        <Grid gutter="xl">
          <Grid.Col xs={12} sm={5} md={4} orderSm={2}>
            <Stack>
              {latestVersion && (
                <Group spacing="xs" style={{ alignItems: 'flex-start' }}>
                  <Stack sx={{ flex: 1 }} spacing={4}>
                    <Button
                      component="a"
                      href={`/api/download/models/${latestVersion?.id}`}
                      download
                    >
                      <Text align="center">
                        {`Download Latest (${formatKBytes(latestVersion?.modelFile?.sizeKB ?? 0)})`}
                      </Text>
                    </Button>
                    {latestVersion.modelFile && (
                      <Group position="apart">
                        <VerifiedText file={latestVersion.modelFile} />
                        <Text size="xs" color="dimmed">
                          {latestVersion.modelFile.format}
                        </Text>
                      </Group>
                    )}
                  </Stack>

                  <Tooltip label={isFavorite ? 'Unlike' : 'Like'} position="bottom" withArrow>
                    <div>
                      <LoginRedirect reason="favorite-model">
                        <Button
                          onClick={() => handleToggleFavorite()}
                          color={isFavorite ? 'red' : 'gray'}
                          sx={{ cursor: 'pointer', paddingLeft: 0, paddingRight: 0, width: '36px' }}
                        >
                          <IconHeart color="#fff" />
                        </Button>
                      </LoginRedirect>
                    </div>
                  </Tooltip>
                </Group>
              )}
              <DescriptionTable items={modelDetails} labelWidth="30%" />
              {model?.type === 'Checkpoint' && (
                <Group position="right" spacing="xs">
                  <IconLicense size={16} />
                  <Text size="xs" color="dimmed">
                    License:{' '}
                    <Text
                      component="a"
                      href="https://huggingface.co/spaces/CompVis/stable-diffusion-license"
                      rel="nofollow"
                      td="underline"
                      target="_blank"
                    >
                      creativeml-openrail-m
                    </Text>
                  </Text>
                </Group>
              )}
            </Stack>
          </Grid.Col>
          <Grid.Col
            xs={12}
            sm={7}
            md={8}
            orderSm={1}
            sx={(theme) => ({
              [theme.fn.largerThan('xs')]: {
                padding: `0 ${theme.spacing.sm}px`,
                margin: `${theme.spacing.sm}px 0`,
              },
            })}
          >
            <Stack>
              <Carousel
                slideSize="50%"
                breakpoints={[{ maxWidth: 'sm', slideSize: '100%', slideGap: 2 }]}
                slideGap="xl"
                align={latestVersion && latestVersion.images.length > 2 ? 'start' : 'center'}
                slidesToScroll={mobile ? 1 : 2}
                withControls={latestVersion && latestVersion.images.length > 2 ? true : false}
                loop
              >
                {latestVersion?.images.map(({ image }) => (
                  <Carousel.Slide key={image.id}>
                    <Center style={{ height: '100%' }}>
                      <ImagePreview
                        image={image}
                        edgeImageProps={{ width: 400 }}
                        nsfw={nsfw}
                        radius="md"
                        lightboxImages={latestVersion.images.map((x) => x.image)}
                        style={{ width: '100%' }}
                        withMeta
                      />
                    </Center>
                  </Carousel.Slide>
                ))}
              </Carousel>
              {model.description ? (
                <ContentClamp maxHeight={300}>
                  <RenderHtml html={model.description} />
                </ContentClamp>
              ) : null}
            </Stack>
          </Grid.Col>
          <Grid.Col span={12} orderSm={3} my="xl">
            <Stack spacing="xl">
              <Title className={classes.title} order={2}>
                Versions
              </Title>
              <ModelVersions
                items={model.modelVersions}
                initialTab={latestVersion?.id.toString()}
                nsfw={nsfw}
              />
            </Stack>
          </Grid.Col>
          <Grid.Col span={12} orderSm={4} my="xl">
            <Stack spacing="xl">
              <Group ref={reviewSectionRef} sx={{ justifyContent: 'space-between' }}>
                <Group spacing={4}>
                  <Title order={3}>Reviews</Title>
                </Group>
                <Group spacing="xs" noWrap grow>
                  <Select
                    defaultValue={ReviewSort.Newest}
                    icon={<IconArrowsSort size={14} />}
                    data={Object.values(ReviewSort)
                      // Only include Newest and Oldest until reactions are implemented
                      .filter((sort) => [ReviewSort.Newest, ReviewSort.Oldest].includes(sort))
                      .map((sort) => ({
                        label: startCase(sort),
                        value: sort,
                      }))}
                    onChange={handleReviewSortChange}
                    size="xs"
                  />
                  <MultiSelect
                    placeholder="Filters"
                    icon={<IconFilter size={14} />}
                    data={Object.values(ReviewFilter).map((sort) => ({
                      label: startCase(sort),
                      value: sort,
                    }))}
                    onChange={handleReviewFilterChange}
                    size="xs"
                    zIndex={500}
                    clearButtonLabel="Clear review filters"
                    clearable
                  />
                  <LoginRedirect reason="create-review">
                    <Button
                      leftIcon={<IconPlus size={16} />}
                      variant="outline"
                      fullWidth={mobile}
                      size="xs"
                      onClick={() => {
                        return openContextModal({
                          modal: 'reviewEdit',
                          title: `Reviewing ${model.name}`,
                          closeOnClickOutside: false,
                          innerProps: {
                            review: {
                              modelId: model.id,
                              modelVersionId:
                                model.modelVersions.length === 1
                                  ? model.modelVersions[0].id
                                  : undefined,
                            },
                          },
                        });
                      }}
                    >
                      Add Review
                    </Button>
                  </LoginRedirect>
                </Group>
              </Group>
              <ModelReviews
                items={reviews}
                onFilterChange={handleReviewFilterChange}
                loading={loadingReviews}
              />
              {/* At the bottom to detect infinite scroll */}
              {reviews.length > 0 ? (
                <InView
                  fallbackInView
                  threshold={1}
                  onChange={(inView) => {
                    if (inView && !isFetchingNextPage && hasNextPage) {
                      fetchNextPage();
                    }
                  }}
                >
                  {({ ref }) => (
                    <Button
                      ref={ref}
                      variant="subtle"
                      onClick={() => fetchNextPage()}
                      disabled={!hasNextPage || isFetchingNextPage}
                    >
                      {isFetchingNextPage
                        ? 'Loading more...'
                        : hasNextPage
                        ? 'Load More'
                        : 'Nothing more to load'}
                    </Button>
                  )}
                </InView>
              ) : null}
            </Stack>
          </Grid.Col>
        </Grid>
      </Container>
      <Modal
        opened={nsfw}
        onClose={() => router.push('/')}
        centered
        withCloseButton={false}
        padding={30}
      >
        <Stack spacing="xl">
          <Text align="center">The content of this model has been marked NSFW</Text>
          <Group position="center">
            <Button variant="default" onClick={() => router.push('/')}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const [route, queryString] = router.asPath.split('?');
                const query = QS.parse(queryString);
                router.replace(
                  {
                    pathname: route,
                    query: { ...query, showNsfw: true },
                  },
                  router.asPath,
                  {
                    shallow: true,
                  }
                );
              }}
            >
              Click to view NSFW
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
